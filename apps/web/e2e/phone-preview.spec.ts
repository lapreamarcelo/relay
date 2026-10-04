import { expect, test } from "@playwright/test";

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
