import { expect, test } from "@playwright/test";
import { COMPOSER_DRAFT_KEY } from "../lib/composer-draft";

test("a media handoff takes precedence over an unrelated recovered draft", async ({ page }) => {
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({
    version: 1, text: "Old unrelated draft", brandId: "brand-aster", campaignId: "",
    selected: [], variants: {}, schedule: true, scheduledAt: "2027-01-10T09:30",
    media: { name: "old.png", url: "https://example.test/old.png", previewUrl: "https://example.test/old.png", type: "image" },
  })), { key: COMPOSER_DRAFT_KEY });
  await page.goto("/demo?view=media");
  const card = page.locator(".media-grid > article").filter({ has: page.getByRole("button", { name: "Use in post", exact: true }) }).first();
  const sourceName = await card.locator(".media-image img").getAttribute("alt");
  await card.getByRole("button", { name: "Use in post", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.getByLabel("Content")).toHaveValue("");
  await expect(composer.locator(".composer-media b")).toHaveText(sourceName!);
  await expect(composer.getByText("Draft recovered", { exact: true })).toBeHidden();
});

test("calendar month navigation does not skip February from January 31", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2027-01-31T12:00:00Z"));
  await page.goto("/demo?view=calendar");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("heading", { name: "January 2027", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next period", exact: true }).click();
  await expect(page.getByRole("heading", { name: "February 2027", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous period", exact: true }).click();
  await expect(page.getByRole("heading", { name: "January 2027", exact: true })).toBeVisible();
});

test("command search excludes videos whose names do not match the query", async ({ page }) => {
  await page.route("**/api/v1/media?*", route => route.fulfill({ json: { data: [
    { key: "media/launch.mp4", name: "launch.mp4", url: "/demo/post-1.svg", size: 1000 },
    { key: "media/holiday.mp4", name: "holiday.mp4", url: "/demo/post-2.svg", size: 1000 },
  ] } }));
  await page.goto("/demo?view=home");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByPlaceholder("Search posts, media, brands, accounts…").fill(".mp4");
  await expect(page.locator(".command-menu > button").filter({ hasText: "holiday.mp4" })).toBeVisible();
  await page.getByPlaceholder("Search posts, media, brands, accounts…").fill("launch.mp4");
  await expect(page.locator(".command-menu > button").filter({ hasText: "launch.mp4" })).toBeVisible();
  await expect(page.locator(".command-menu > button").filter({ hasText: "holiday.mp4" })).toHaveCount(0);
});

test("analytics hydrates without server/client date mismatches", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/demo?view=analytics");
  await expect(page.getByRole("heading", { name: "Period leaders", exact: true })).toBeVisible();
  expect(errors.filter(message => /hydrat|server rendered HTML|#418/.test(message))).toEqual([]);
});

for (const width of [320, 375, 430]) {
  test(`mobile composer actions remain fully visible at ${width}px`, async ({ page, isMobile }) => {
    test.skip(!isMobile, "Phone composer coverage");
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/demo?view=media");
    await page.getByRole("button", { name: "Use in post", exact: true }).first().click();
    const composer = page.getByRole("dialog", { name: "Create post" });
    await composer.getByLabel("Content", { exact: true }).fill("Mobile layout verification");
    await composer.locator(".destination-list button").filter({ hasText: "Instagram" }).click();
    for (const name of ["Save draft", "Schedule post"]) {
      const action = composer.getByRole("button", { name, exact: true });
      await expect(action).toBeEnabled();
      const bounds = await action.boundingBox();
      expect(bounds!.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width, `${name} right edge`).toBeLessThanOrEqual(width);
      expect(bounds!.y + bounds!.height, `${name} bottom edge`).toBeLessThanOrEqual(812);
    }
    if (width === 375) await page.screenshot({ path: "/tmp/relay-review-mobile-composer.png" });
    await composer.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(composer).toBeHidden();
  });

  test(`mobile navigation and page actions fit at ${width}px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Phone layout coverage");
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/demo?view=home");
    for (const name of ["Home", "Calendar", "Posts", "Slide Studio", "Video Studio", "Analytics", "Media", "Brands", "Accounts 4", "Settings", "CLI & API"]) {
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("button", { name: "Close menu", exact: true })).toBeHidden();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${name} overflows at ${width}px` }).toBeLessThanOrEqual(1);
    }
    await page.getByRole("button", { name: "Create post", exact: true }).first().click();
    const composer = page.getByRole("dialog", { name: "Create post" });
    await composer.getByLabel("Content").fill("Mobile verification draft");
    await composer.locator(".destination-list button").filter({ hasText: "Instagram" }).click();
    await composer.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(composer).toBeHidden();
  });
}
