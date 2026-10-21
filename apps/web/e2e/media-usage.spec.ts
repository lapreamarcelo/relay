import { expect, test } from "@playwright/test";

test("gallery labels post usage and combines status, type, folder, and page filters", async ({ page }) => {
  const folderId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const usage = (scheduled = 0, published = 0, publishing = 0) => ({ scheduled, published, publishing });
  const assets = [
    { name: "scheduled.png", postUsage: usage(1) },
    { name: "published.png", postUsage: usage(0, 1) },
    { name: "shared.png", postUsage: usage(1, 2) },
    { name: "none.png", postUsage: usage() },
    { name: "publishing.png", postUsage: usage(0, 0, 1) },
  ].map((item) => ({ ...item, key: `media-projects/${folderId}/media/${item.name}`, url: "/demo/post-1.svg", size: 100, lastModified: null, etag: null }));
  const requests: URL[] = [];
  await page.route("**/api/v1/media/projects", (route) => route.fulfill({ json: { data: [{ id: folderId, name: "Usage test folder", kind: "media", count: 5, createdAt: new Date().toISOString() }] } }));
  await page.route(/\/api\/v1\/media\?/, (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const filter = url.searchParams.get("usage") ?? "all";
    const matched = assets.filter((asset) => filter === "all" || (filter === "none" ? Object.values(asset.postUsage).every((count) => count === 0) : asset.postUsage[filter as "scheduled" | "published" | "publishing"] > 0));
    const data = url.searchParams.get("mediaType") === "video" ? [] : url.searchParams.has("cursor") ? matched.slice(4) : matched.slice(0, 4);
    return route.fulfill({ json: { data, pagination: { nextCursor: !url.searchParams.has("cursor") && matched.length > 4 ? "next-page" : null } } });
  });
  await page.goto("/demo?view=media");
  const cards = page.locator(".media-grid > article:not(.media-folder-card)");
  const card = (name: string) => cards.filter({ has: page.locator("b", { hasText: new RegExp(`^${name.replace(".", "\\.")}$`) }) });
  const labels = (name: string) => card(name).locator(".media-usage-label");
  await expect(cards).toHaveCount(4);
  await expect(labels("scheduled.png")).toHaveText(["Scheduled"]);
  await expect(labels("published.png")).toHaveText(["Published"]);
  await expect(labels("shared.png")).toHaveText(["Scheduled", "Published"]);
  await expect(labels("none.png")).toHaveText(["None"]);

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(labels("publishing.png")).toHaveText(["Publishing"]);
  const filter = page.getByRole("combobox", { name: "Post usage", exact: true });
  await filter.selectOption("scheduled");
  await expect(cards).toHaveCount(2);
  await expect(page.locator(".media-pagination")).toContainText("Page 1");
  expect(requests.at(-1)?.searchParams.get("usage")).toBe("scheduled");
  expect(requests.at(-1)?.searchParams.has("cursor")).toBe(false);
  await card("scheduled.png").getByRole("button", { name: "Delete scheduled.png", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("can cause those posts to fail");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();

  await filter.selectOption("published");
  await expect(cards).toHaveCount(2);
  await expect(labels("shared.png")).toHaveText(["Scheduled", "Published"]);
  await filter.selectOption("none");
  await expect(cards).toHaveCount(1);
  await expect(labels("none.png")).toHaveText(["None"]);
  await filter.selectOption("publishing");
  await expect(labels("publishing.png")).toHaveText(["Publishing"]);
  await filter.selectOption("scheduled");
  await expect(cards).toHaveCount(2);
  await page.locator(".media-folder-node").filter({ hasText: "Usage test folder" }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("project")).toBe(folderId);
  expect(requests.at(-1)?.searchParams.get("usage")).toBe("scheduled");
  await page.getByRole("button", { name: "Videos", exact: true }).click();
  await expect(page.getByText("No media matches these filters", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("mediaType")).toBe("video");
  expect(requests.at(-1)?.searchParams.get("usage")).toBe("scheduled");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
