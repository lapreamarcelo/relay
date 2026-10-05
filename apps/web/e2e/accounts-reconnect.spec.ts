import { expect, test } from "@playwright/test";

test("healthy accounts hide reconnect controls without mobile overflow", async ({ page }) => {
  await page.goto("/demo?view=accounts");
  const rows = page.locator(".account-list article");
  await expect(rows).toHaveCount(4);
  await expect(rows.locator(".account-reconnect")).toHaveCount(0);
  await expect(rows.locator(".status.connected")).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
});
