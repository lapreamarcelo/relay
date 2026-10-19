import { expect, test } from "@playwright/test";

for (const browser of [{ locale: "es-ES", timezoneId: "Europe/Madrid" }, { locale: "ja-JP", timezoneId: "Pacific/Honolulu" }]) {
  test.describe(`${browser.locale} hydration`, () => {
    test.use(browser);
    for (const view of ["videos", "slideshows", "home"]) test(`${view} hydrates and displays browser-local dates`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      // Keep the SSR data visible so a fast API response cannot hide a mismatch.
      for (const endpoint of ["videos", "slideshows"]) await page.route(`**/api/v1/${endpoint}`, route => route.fulfill({ json: { data: [] } }));
      await page.goto(`/demo?view=${view}`);
      const date = page.locator(view === "videos" ? ".video-project-grid time" : view === "slideshows" ? ".slideshow-project-grid time" : ".home-agenda time").first();
      await expect(date).toBeVisible();
      const expected = await date.evaluate((element, currentView) => new Date(element.getAttribute("datetime")!).toLocaleDateString(undefined, currentView === "home" ? { month: "short", day: "numeric" } : undefined), view);
      await expect(date).toHaveText(expected);
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByRole("dialog", { name: "Search Relay", exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}
