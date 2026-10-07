import { expect, test, type Locator, type Page } from "@playwright/test";
import { demoSlideshowProjects, demoVideoProjects } from "../lib/demo-data";

async function inViewport(page: Page, dialog: Locator, centered = true) {
  await expect(dialog).toBeVisible();
  await expect.poll(async () => {
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    if (!box) return false;
    return box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1
      && (!centered || Math.abs(box.x + box.width / 2 - viewport.width / 2) < 3 && Math.abs(box.y + box.height / 2 - viewport.height / 2) < 3);
  }).toBe(true);
}

for (const studio of ["videos", "slideshows"] as const) {
  test(`${studio} deletion stays centered on a long scrolled page and locks background scrolling`, async ({ page }) => {
    const projects = Array.from({ length: 36 }, (_, index) => ({
      ...(studio === "videos" ? demoVideoProjects[0] : demoSlideshowProjects[0]),
      id: `layout-${index}`, name: `Layout project ${index}`, sourceUrl: "", renderedUrl: undefined,
    }));
    await page.route(`**/api/v1/${studio}`, route => route.fulfill({ json: { data: projects } }));
    await page.goto(`/demo?view=${studio}`);
    const rows = page.locator(studio === "videos" ? ".video-project-grid > article" : ".slideshow-project-grid > article");
    await expect(rows).toHaveCount(36);
    const trigger = rows.nth(20).locator(".icon-button.danger");
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const dialog = page.getByRole("alertdialog");
    await inViewport(page, dialog);
    // Clicking may scroll the trigger fully into view before the dialog opens.
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(0);
    expect(await dialog.evaluate(element => element.closest(".modal-layer")?.parentElement === document.body)).toBe(true);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });
}

test("post details and nested composer pickers stay in the viewport", async ({ page }) => {
  await page.goto("/demo?view=posts");
  const row = page.locator(".post-row").last();
  await row.getByRole("button", { name: "Post actions" }).click();
  await row.getByRole("menuitem", { name: "View details" }).click();
  await inViewport(page, page.getByRole("dialog", { name: "Post details" }));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await inViewport(page, composer);
  await composer.getByRole("button", { name: "Add media", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Where is your media?" });
  await inViewport(page, picker);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(composer).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(composer).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("brand dialogs fit a short viewport and scroll their contents", async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 460 });
  await page.route("**/api/v1/brands", route => route.fulfill({ json: { data: [] } }));
  await page.goto("/demo?view=brands");
  await page.getByRole("button", { name: /New brand|Create brand/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create a brand workspace" });
  await inViewport(page, dialog);
  expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("search and account dialogs stay centered in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 460 });
  await page.goto("/demo?view=accounts");
  await page.getByRole("button", { name: "Connect account", exact: true }).click();
  const account = page.getByRole("dialog", { name: "Connect an account" });
  await inViewport(page, account);
  await page.keyboard.press("Escape");
  await expect(account).toBeHidden();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  const search = page.getByRole("dialog", { name: "Search Relay" });
  await inViewport(page, search);
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});
