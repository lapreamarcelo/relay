import { expect, test } from "@playwright/test";

test("every connected account exposes its existing reconnect flow without mobile overflow", async ({ page }) => {
  await page.goto("/demo?view=accounts");
  const rows = page.locator(".account-list article");
  await expect(rows).toHaveCount(4);
  await expect(rows.locator(".account-reconnect")).toHaveCount(4);
  const instagram = rows.filter({ hasText: "@aster.studio" });
  await expect(instagram.getByRole("link", { name: "Reconnect Aster Studio" })).toHaveAttribute("href", "/api/oauth/instagram-standalone/start?brandId=brand-aster");
  await expect(rows.filter({ hasText: "Facebook" }).getByRole("link", { name: "Reconnect Field Notes" })).toHaveAttribute("href", "/api/oauth/facebook/start?brandId=brand-field");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
});
