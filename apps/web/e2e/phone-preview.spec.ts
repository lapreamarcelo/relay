import { expect, test } from "@playwright/test";

test("carousel preview navigates ordered slides in feed and mobile modes", async ({ page }) => {
  const urls = [1, 2, 3].map((slide) => `https://media.example.com/slide-${slide}.svg`);
  await page.route("https://media.example.com/**", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#25483e"/></svg>',
  }));
  await page.addInitScript((slides) => localStorage.setItem("relay-composer-draft-v1", JSON.stringify({
    version: 1, text: "Carousel preview", brandId: "brand-aster", selected: ["account-instagram", "account-tiktok"],
    media: { name: "Launch slides", url: slides[0], previewUrl: slides[0], type: "image", urls: slides },
    schedule: false, scheduledAt: "2026-10-21T09:30",
  })), urls);
  await page.goto("/demo");
  await page.getByRole("button", { name: /Create post/ }).first().click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  const carousel = composer.getByRole("group", { name: "Media preview", exact: true });
  const previous = carousel.getByRole("button", { name: "Previous slide" });
  const next = carousel.getByRole("button", { name: "Next slide" });
  await expect(carousel.getByRole("status")).toHaveText("1 / 3");
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(carousel.locator("img")).toHaveAttribute("src", urls[1]);
  await expect(carousel.getByRole("status")).toHaveText("2 / 3");
  await next.click();
  await expect(carousel.locator("img")).toHaveAttribute("src", urls[2]);
  await expect(next).toBeDisabled();
  await previous.click();
  await composer.getByRole("button", { name: "Mobile", exact: true }).click();
  await expect(carousel.getByRole("status")).toHaveText("2 / 3");
  await carousel.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(carousel.locator("img")).toHaveAttribute("src", urls[0]);
  await page.keyboard.press("End");
  await expect(carousel.getByRole("status")).toHaveText("3 / 3");
  await page.keyboard.press("Home");
  const swipe = async (from: number, to: number) => carousel.evaluate((element, { from, to }) => {
    const start = new Touch({ identifier: 1, target: element, clientX: from, clientY: 100 });
    const end = new Touch({ identifier: 1, target: element, clientX: to, clientY: 105 });
    element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [start] }));
    element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }));
  }, { from, to });
  await swipe(220, 100);
  await expect(carousel.getByRole("status")).toHaveText("2 / 3");
  await swipe(100, 220);
  await expect(carousel.getByRole("status")).toHaveText("1 / 3");
  await composer.locator(".preview-provider-tabs").getByRole("button", { name: "TikTok", exact: true }).click();
  await expect(composer.locator(".reel-media.preview-carousel")).toBeVisible();
  await next.click();
  await expect(carousel.locator("img")).toHaveAttribute("src", urls[1]);
  await expect(carousel.getByRole("status")).toHaveText("2 / 3");
  await composer.getByRole("button", { name: "Remove media", exact: true }).click();
  await expect(carousel).toHaveCount(0);
});

test("phone preview contains portrait artwork and scrolls long captions inside the device", async ({ page }) => {
  await page.route("**/demo/post-1.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#25483e"/><text x="80" y="120" fill="white" font-size="70">Portrait artwork</text><text x="80" y="1270" fill="white" font-size="70">Full image visible</text></svg>',
  }));
  await page.goto("/demo?view=posts");
  const row = page.locator(".post-row").filter({ hasText: "A small ritual for better creative work" });
  await row.getByRole("button", { name: "Post actions" }).click();
  await row.getByRole("menuitem", { name: "Duplicate post" }).click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await composer.locator(".platform-card").filter({ hasText: "Instagram" }).getByLabel("Publish as").selectOption("feed");
  await composer.getByLabel("Content", { exact: true }).fill("A portrait post with a long caption. ".repeat(20) + "https://example.com/" + "long-source-url-".repeat(30));
  await composer.getByRole("button", { name: "Mobile", exact: true }).click();
  const phone = composer.locator(".social-preview.mobile");
  const content = phone.getByRole("region", { name: "Post preview" });
  const image = phone.locator(".preview-media img");
  await expect(phone.getByRole("button", { name: "Next slide" })).toHaveCount(0);
  await phone.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalHeight)).toBe(1350);
  await expect.poll(async () => {
    const bounds = await phone.locator(".preview-media").boundingBox();
    return bounds ? bounds.width / bounds.height : 0;
  }).toBeCloseTo(.8, 2);
  const before = (await phone.boundingBox())!;
  const panel = (await composer.locator(".preview-panel").boundingBox())!;
  expect(before.height / before.width).toBeCloseTo(19.5 / 9, 2);
  expect(before.y + before.height).toBeLessThanOrEqual(panel.y + panel.height);
  await phone.getByRole("button", { name: "more", exact: true }).click();
  await expect(phone.getByRole("button", { name: "less", exact: true })).toHaveAttribute("aria-expanded", "true");
  expect((await phone.boundingBox())!.height).toBeCloseTo(before.height, 1);
  await expect.poll(() => content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await content.focus();
  await page.keyboard.press("End");
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(phone.locator(".phone-home-indicator")).toBeInViewport();
  await phone.getByRole("button", { name: "less", exact: true }).click();
  await composer.getByLabel("Content", { exact: true }).fill("Short caption");
  await expect(phone.getByRole("button", { name: "more", exact: true })).toHaveCount(0);
  await expect(phone.locator(".preview-caption-text")).toHaveText("Short caption");
});
