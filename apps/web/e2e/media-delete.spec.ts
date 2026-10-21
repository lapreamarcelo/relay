import { expect, test, type Page } from "@playwright/test";

async function gallery(page: Page, options: { paginate?: boolean; failOnce?: boolean } = {}) {
  const assets = ["first.mp4", "second.mp4", "third.mp4", "keep.mp4"].map((name, index) => ({ key: `media-owners/demo/media/${name}`, name, url: "/demo/post-1.svg", size: 100, lastModified: null, etag: null, postUsage: { scheduled: index === 2 ? 1 : 0, published: 1, publishing: 0 } }));
  const calls: string[] = [];
  const deleted = new Set<string>();
  const failed = new Set<string>();
  await page.route("**/api/v1/media/projects", (route) => route.fulfill({ json: { data: [] } }));
  await page.route(/\/api\/v1\/media\?/, (route) => {
    const remaining = assets.filter((asset) => !deleted.has(asset.key));
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({ json: { data: options.paginate ? remaining.slice(cursor ? 2 : 0, cursor ? 4 : 2) : remaining, pagination: { nextCursor: options.paginate && !cursor && remaining.length > 2 ? "next-page" : null } } });
  });
  await page.route("**/api/v1/media", (route) => {
    expect(route.request().method()).toBe("DELETE");
    const { key } = route.request().postDataJSON() as { key: string };
    calls.push(key);
    if (options.failOnce && key !== assets[0].key && !failed.has(key)) {
      failed.add(key);
      return key === assets[1].key ? route.fulfill({ status: 500, json: { error: "Storage unavailable" } }) : route.abort("failed");
    }
    deleted.add(key);
    return route.fulfill({ status: 204 });
  });
  await page.goto("/demo?view=media");
  await page.getByRole("combobox", { name: "Post usage", exact: true }).selectOption("published");
  await page.getByRole("button", { name: "Videos", exact: true }).click();
  await expect(page.locator(".media-grid > article")).toHaveCount(options.paginate ? 2 : 4);
  return { assets, calls, deleted };
}

test("clearing and cancelling preserve files; confirmed bulk deletion includes selections on other pages", async ({ page }) => {
  const { assets, calls, deleted } = await gallery(page, { paginate: true });
  const selection = page.locator(".media-selection-bar");
  await page.getByRole("button", { name: "Select first.mp4", exact: true }).click();
  await selection.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(selection).toHaveCount(0);
  expect(calls).toEqual([]);
  await expect(page.locator(".media-grid > article")).toHaveCount(2);
  await page.getByRole("button", { name: "Select first.mp4", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Select third.mp4", exact: true }).click();
  await expect(selection).toContainText("2 selected");
  await selection.getByRole("button", { name: "Delete selected", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Delete 2 selected files?");
  await expect(dialog).toContainText("first.mp4, third.mp4");
  await expect(dialog).toContainText("other pages or in other folders");
  await expect(dialog).toContainText("can cause those posts to fail");
  expect(calls).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(selection).toContainText("2 selected");
  expect(calls).toEqual([]);
  await selection.getByRole("button", { name: "Delete selected", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete 2 files", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(calls).toEqual([assets[0].key, assets[2].key]);
  expect([...deleted]).toEqual(calls);
  await expect(selection).toHaveCount(0);
  await expect(page.locator(".media-grid b")).toHaveText(["second.mp4", "keep.mp4"]);
  await expect(page.locator(".media-pagination")).toContainText("Page 1");
  await expect(page.getByText("2 files deleted.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("partial failures preserve failed selections and retry only the remaining files", async ({ page }) => {
  const { assets, calls } = await gallery(page, { failOnce: true });
  for (const name of ["first.mp4", "second.mp4", "third.mp4"]) await page.getByRole("button", { name: `Select ${name}`, exact: true }).click();
  const selection = page.locator(".media-selection-bar");
  await selection.getByRole("button", { name: "Delete selected", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Delete 3 files", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("1 of 3 files deleted. 2 could not be deleted and remain selected. Try again.");
  await expect(dialog).toContainText("Delete 2 selected files?");
  await expect(selection).toContainText("2 selected");
  await expect(page.locator(".media-grid b")).toHaveText(["second.mp4", "third.mp4", "keep.mp4"]);
  await dialog.getByRole("button", { name: "Delete 2 files", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(calls).toEqual([assets[0].key, assets[1].key, assets[2].key, assets[1].key, assets[2].key]);
  await expect(selection).toHaveCount(0);
  await expect(page.locator(".media-grid b")).toHaveText(["keep.mp4"]);
});
