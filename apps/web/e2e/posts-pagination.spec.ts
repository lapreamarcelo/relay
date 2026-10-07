import { expect, test, type Page } from "@playwright/test";

async function addDraft(page: Page) {
  await page.getByRole("button", { name: /Create post/ }).first().click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await composer.getByLabel("Content").fill("A pagination test draft");
  await composer.locator(".destination-list button").filter({ hasText: "Instagram" }).click();
  await composer.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(composer).toBeHidden();
}

test("posts paginate after filtering and reset when filters or page size change", async ({ page }) => {
  await page.goto("/demo?view=posts");
  await addDraft(page);
  const controls = page.getByRole("navigation", { name: "Posts pagination", exact: true });
  const rows = page.locator(".posts-list .post-row");
  await expect(rows).toHaveCount(10);
  await expect(page.locator(".post-pagination-summary")).toContainText("1–10 of 11 posts");
  const firstPageCaptions = await rows.locator(".post-main p").allTextContents();
  await controls.getByRole("button", { name: "Next" }).click();
  await expect(rows).toHaveCount(1);
  await expect(controls).toContainText("Page 2 of 2");
  await expect(controls.getByRole("button", { name: "Next" })).toBeDisabled();
  await expect(page).toHaveURL(/page=2/);
  expect(firstPageCaptions).not.toContain(await rows.locator(".post-main p").textContent());
  await page.getByRole("navigation", { name: "Posts pagination footer" }).getByRole("button", { name: "Previous" }).click();
  await expect(rows.locator(".post-main p")).toHaveText(firstPageCaptions);
  await controls.getByRole("button", { name: "Next" }).click();
  await page.getByRole("combobox", { name: "Per page", exact: true }).selectOption("25");
  await expect(rows).toHaveCount(11);
  await expect(controls).toContainText("Page 1 of 1");
  await expect(page).toHaveURL(/perPage=25/);
  await page.getByRole("combobox", { name: "Per page", exact: true }).selectOption("10");
  await controls.getByRole("button", { name: "Next" }).click();
  await page.locator(".tabs").getByRole("button", { name: /Published/ }).click();
  await expect(rows).toHaveCount(8);
  await expect(controls).toContainText("Page 1 of 1");
  await page.locator(".tabs").getByRole("button", { name: /^All/ }).click();
  await controls.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("combobox", { name: "Media", exact: true }).selectOption("without");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("A pagination test draft");
  await expect(controls).toContainText("Page 1 of 1");
  await page.getByRole("combobox", { name: "Network", exact: true }).selectOption("tiktok");
  await expect(rows).toHaveCount(0);
  await expect(page.locator(".post-pagination-summary")).toContainText("0 posts");
  await expect(page.getByText("No posts match these filters", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(rows).toHaveCount(10);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
});

test("deleting the only post on the last page returns to an existing page", async ({ page }) => {
  await page.route("**/api/v1/posts", (route) => route.fulfill({ json: { data: { deleted: true } } }));
  await page.goto("/demo?view=posts");
  await addDraft(page);
  const controls = page.getByRole("navigation", { name: "Posts pagination", exact: true });
  await controls.getByRole("button", { name: "Next" }).click();
  const row = page.locator(".posts-list .post-row");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Post actions" }).click();
  await row.getByRole("menuitem", { name: "Delete from Relay" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete post", exact: true }).click();
  await expect(page.locator(".posts-list .post-row")).toHaveCount(10);
  await expect(controls).toContainText("Page 1 of 1");
  await expect(page).not.toHaveURL(/page=2/);
});

test("posts restore page size and handle stale or invalid page URLs", async ({ page }) => {
  await page.goto("/demo?view=posts&perPage=25&page=99");
  const controls = page.getByRole("navigation", { name: "Posts pagination", exact: true });
  await expect(page.getByRole("combobox", { name: "Per page", exact: true })).toHaveValue("25");
  await expect(controls).toContainText("Page 1 of 1");
  await expect(page).not.toHaveURL(/page=99/);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Per page", exact: true })).toHaveValue("25");
  await page.goto("/demo?view=posts&perPage=7&page=-2");
  await expect(page.getByRole("combobox", { name: "Per page", exact: true })).toHaveValue("10");
  await expect(page.locator(".posts-list .post-row")).toHaveCount(10);
  await expect(controls.getByRole("button", { name: "Previous" })).toBeDisabled();
});
