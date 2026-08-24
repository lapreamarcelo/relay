import { expect, test } from "@playwright/test";

test("planner is URL-backed and exposes campaign operations", async ({ page }) => {
  await page.goto("/demo?view=calendar");
  await expect(page).toHaveURL(/view=calendar/);
  await expect(page.getByRole("heading", { name: "August 2026" })).toBeVisible();
  await expect(page.getByLabel("Brand")).toBeVisible();
  await expect(page.getByPlaceholder("New campaign")).toBeVisible();
  await expect(page.locator(".planning-event.scheduled").first()).toHaveAttribute("draggable", "true");
  await page.getByLabel("Brand").selectOption("brand-aster");
  await expect(page).toHaveURL(/brand=brand-aster/);
  await page.getByLabel("Account").selectOption("account-instagram");
  await expect(page).toHaveURL(/account=account-instagram/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "August 2026" })).toBeVisible();
  await expect(page.getByLabel("Brand")).toHaveValue("brand-aster");
  await expect(page.getByLabel("Account")).toHaveValue("account-instagram");
});

test("command menu searches real posts and supports the keyboard", async ({ page }) => {
  await page.goto("/demo?view=calendar");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  const search = page.getByPlaceholder("Search posts, media, brands, accounts…");
  await search.fill("ritual");
  await expect(page.locator(".command-menu > button")).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(search).toBeFocused();
});

test("composer autosaves and recovers an unfinished draft", async ({ page }) => {
  await page.goto("/demo?view=calendar");
  await page.getByRole("button", { name: /Create post/ }).first().click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await composer.getByLabel("Content").fill("A recovered planning note");
  await composer.getByRole("button", { name: /Instagram/ }).click();
  await expect(composer.getByRole("button", { name: "Save draft" })).toBeEnabled();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Create post/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Create post" }).getByLabel("Content")).toHaveValue("A recovered planning note");
  await expect(page.getByText("Draft recovered")).toBeVisible();
});

test("composer previews network-specific captions and scheduling context", async ({ page }) => {
  await page.goto("/demo?view=calendar");
  await page.getByRole("button", { name: /Create post/ }).first().click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await composer.getByLabel("Content").fill("Shared launch caption");
  await composer.locator(".destination-list button").filter({ hasText: "Instagram" }).click();
  await composer.locator(".destination-list button").filter({ hasText: "TikTok" }).click();
  await composer.locator(".network-variants label").filter({ hasText: "TikTok" }).locator("textarea").fill("TikTok-specific launch caption");
  await composer.locator(".preview-provider-tabs button").filter({ hasText: "TikTok" }).click();
  await expect(composer.locator(".social-preview > p")).toHaveText("TikTok-specific launch caption");
  await expect(composer.getByLabel(/Publish date and time in Europe\/Madrid/)).toBeVisible();
});

test("account and OAuth dialogs keep keyboard focus and close with Escape", async ({ page }) => {
  await page.goto("/demo?view=accounts");
  await page.getByRole("button", { name: "Disconnect Aster Studio" }).first().click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("[aria-modal='true']")))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await page.getByRole("button", { name: "Connect account" }).click();
  await expect(page.getByRole("dialog", { name: "Connect an account" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Connect an account" })).toBeHidden();
});

test("media library exposes upload and project organization controls", async ({ page }) => {
  await page.goto("/demo?view=media");
  await expect(page.getByRole("button", { name: /Upload to/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /New folder/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Music" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Unsorted/ })).toBeHidden();
});

test("historical analytics filters persist in the URL and reports can be scheduled", async ({ page }) => {
  await page.route("**/api/v1/analytics/reports", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: { data: { id: "report-1", name: "Monthly performance report", cadence: "monthly", nextRunAt: "2026-09-23T08:00:00.000Z", lastSentAt: null } } });
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto("/demo?view=analytics&analyticsDays=90&provider=tiktok&media=video");
  await expect(page.getByRole("button", { name: "90 days" })).toHaveClass(/active/);
  await expect(page.getByLabel("Analytics platform")).toHaveValue("tiktok");
  await expect(page.getByLabel("Analytics content type")).toHaveValue("video");
  await page.getByLabel("Report cadence").selectOption("monthly");
  await page.getByRole("button", { name: "Schedule report" }).click();
  await expect(page.getByText("Monthly performance report")).toBeVisible();
});

test("video studio exposes draggable labels, style shortcuts, and bulk music policies", async ({ page }) => {
  const project = { id: "video-1", brandId: "brand-aster", name: "Hook reel", caption: "{hook}", sourceUrl: "", sourceFolderId: "media-folder", labels: [{ id: "label-1", text: "Launch hook", x: .5, y: .18, width: .84, fontSize: 72, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark" }], createdAt: "2026-08-20T10:00:00.000Z", updatedAt: "2026-08-23T10:00:00.000Z" };
  await page.route("**/api/v1/videos", (route) => route.fulfill({ json: { data: route.request().method() === "GET" ? [project] : { ...project, sourceUrl: "https://media.example.com/device.mp4" } } }));
  await page.route("**/api/v1/videos/render", (route) => route.fulfill({ json: { data: { ...project, sourceUrl: "https://media.example.com/device.mp4", renderedUrl: "https://media.example.com/hook-reel.mp4" }, folder: { id: "video-output", name: "Hook reel · render" } } }));
  await page.route("**/api/v1/media/projects", (route) => route.fulfill({ json: { data: [{ id: "media-folder", name: "Aster clips", kind: "media", count: 1, createdAt: "2026-08-20T10:00:00.000Z" }, { id: "music-folder", name: "Launch music", kind: "music", count: 3, createdAt: "2026-08-20T10:00:00.000Z" }] } }));
  await page.route("**/api/v1/media", (route) => route.fulfill({ json: { key: "media-folder/device.mp4", uploadUrl: "https://upload.example.test/device.mp4", url: "https://media.example.com/device.mp4" } }));
  await page.route("**/api/v1/media?**", (route) => route.request().method() === "POST" ? route.fulfill({ json: { key: "media-folder/device.mp4", uploadUrl: "https://upload.example.test/device.mp4", url: "https://media.example.com/device.mp4" } }) : route.fulfill({ json: { data: route.request().url().includes("kind=music") ? [] : [{ key: "media-folder/source.mp4", name: "source.mp4", url: "https://media.example.com/source.mp4", kind: "media" }] } }));
  await page.route("https://upload.example.test/**", (route) => route.fulfill({ status: 200, body: "" }));
  await page.goto("/demo?view=videos");
  await page.getByRole("button", { name: /Hook reel/ }).first().click();
  await expect(page.locator(".video-studio")).toHaveCSS("opacity", "1");
  await expect(page.getByText("Add a source video")).toBeVisible();
  await expect(page.locator(".video-empty-actions").getByRole("button", { name: "Upload video" })).toBeVisible();
  await expect(page.locator(".video-label-canvas .creative-label")).toHaveCount(0);
  await expect(page.locator(".video-stage > p")).toHaveCount(0);
  const sourceSection = page.locator(".video-inspector > section").first();
  await expect(sourceSection.getByRole("button", { name: "Choose from Media" })).toBeVisible();
  await expect(sourceSection.getByRole("button", { name: "Upload video" })).toBeVisible();
  await expect(sourceSection.getByRole("combobox")).toHaveCount(0);
  await page.locator(".video-empty-actions").getByRole("button", { name: "Browse Media" }).click();
  await expect(page.getByRole("dialog", { name: "Choose your source clip" })).toBeVisible();
  await expect(page.locator(".video-source-thumb")).toHaveCount(1);
  await expect(page.locator(".video-source-thumb-fallback")).toContainText(/Loading preview|Preview unavailable/);
  await page.getByRole("button", { name: /source.mp4/ }).click();
  await page.locator('input[type="file"][accept*="video"]').setInputFiles({ name: "device.mp4", mimeType: "video/mp4", buffer: Buffer.from("video") });
  await expect(page.getByText("device.mp4 uploaded to Media and selected.")).toBeVisible();
  await expect(page.locator(".video-label-canvas .creative-label")).toBeVisible();
  await expect(page.getByText("Drag any label directly on the video")).toBeVisible();
  await expect(page.locator(".label-style-shortcuts button")).toHaveCount(3);
  await expect(page.getByLabel("Label text color")).toHaveValue("#ffffff");
  await expect(page.getByLabel("Label background color")).toHaveValue("#000000");
  await expect(page.getByLabel("Label font")).toHaveValue("modern");
  await page.getByLabel("Label font").selectOption("editorial");
  await expect(page.getByLabel("Label font")).toHaveValue("editorial");
  await expect(page.getByLabel("Label height")).toHaveValue("12");
  await page.getByLabel("Label height").fill("20");
  await expect(page.getByLabel("Label height")).toHaveValue("20");
  await expect(page.locator(".video-label-canvas .creative-label")).toHaveAttribute("style", /height: 20%/);
  await page.getByRole("button", { name: "Add label" }).click();
  await expect(page.locator(".video-label-tabs button")).toHaveCount(2);
  await page.getByRole("button", { name: "White / clear" }).click();
  await expect(page.getByRole("button", { name: "White / clear" })).toHaveClass(/active/);
  const videoHandoff = page.locator(".video-inspector .slideshow-handoff");
  await expect(videoHandoff.getByLabel("Brand")).toHaveCount(0);
  await expect(videoHandoff.getByLabel("Caption")).toHaveCount(0);
  await page.getByRole("button", { name: /Bulk hooks/ }).click();
  await expect(page.getByRole("dialog", { name: "Turn hooks into scheduled videos" })).toBeVisible();
  await expect(page.getByText("One song for all")).toBeVisible();
  await expect(page.getByText("Different in order")).toBeVisible();
  await expect(page.getByText("Random from folder")).toBeVisible();
  await page.getByLabel("Close batch generator").click({ position: { x: 4, y: 4 } });
  await videoHandoff.getByRole("button", { name: "Create post" }).click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.getByText("Hook reel.mp4")).toBeVisible();
  await expect(composer.getByRole("group", { name: /Brand/ })).toBeVisible();
  await expect(composer.locator(".destination-list button").filter({ hasText: "Instagram" })).toBeEnabled();
  await expect(composer.locator(".destination-list button").filter({ hasText: "YouTube" })).toBeEnabled();
});

test("slideshow and video use the same label controls", async ({ page }) => {
  const slides = [{ id: "slide-1", mediaUrl: "https://media.example.com/slide-1.jpg", text: "A clearer launch", fit: "cover" as const, textPosition: "bottom" as const, textX: .5, textY: .78, textWidth: .87, textHeight: .12, textSize: 64, textFont: "modern" as const, textColor: "#FFFFFF", textBackground: "dark" as const, textBackgroundColor: "#000000" }, { id: "slide-2", mediaUrl: "https://media.example.com/slide-2.jpg", text: "In order", fit: "cover" as const, textPosition: "bottom" as const, textX: .5, textY: .78, textWidth: .87, textHeight: .12, textSize: 64, textFont: "modern" as const, textColor: "#FFFFFF", textBackground: "dark" as const, textBackgroundColor: "#000000" }];
  const project = { id: "slides-1", brandId: "brand-aster", name: "Launch carousel", caption: "Launch caption", slides, createdAt: "2026-08-20T10:00:00.000Z", updatedAt: "2026-08-23T10:00:00.000Z" };
  await page.route("**/api/v1/slideshows", (route) => route.fulfill({ json: { data: route.request().method() === "GET" ? [project] : project } }));
  await page.route("**/api/v1/slideshows/render", (route) => route.fulfill({ json: { data: { ...project, slides: slides.map((slide, index) => ({ ...slide, renderedUrl: `https://media.example.com/${index + 1}.png` })) }, folder: { id: "folder-1", name: "Launch carousel · render" } } }));
  await page.goto("/demo?view=slideshows");
  await page.getByRole("button", { name: /Launch carousel/ }).first().click();
  await expect(page.locator(".slide-inspector .label-style-shortcuts button")).toHaveCount(3);
  await expect(page.getByLabel("Label font")).toHaveValue("modern");
  await page.getByLabel("Label font").selectOption("mono");
  await expect(page.getByLabel("Label font")).toHaveValue("mono");
  await expect(page.getByLabel("Label width")).toHaveValue("87");
  await expect(page.getByLabel("Label height")).toHaveValue("12");
  await page.getByLabel("Label text color").fill("#ff5c35");
  await page.getByLabel("Label background color").fill("#123456");
  await expect(page.locator(".slide-stage .slide-title")).toHaveAttribute("style", /background-color: rgb\(18, 52, 86\)/);
  await page.getByLabel("Label height").fill("20");
  await expect(page.locator(".slide-stage .slide-title")).toHaveAttribute("style", /height: 20%/);
  await page.locator(".slideshow-handoff").getByRole("button", { name: "Create post" }).click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.getByText("2 ordered slides ready")).toBeVisible();
  await expect(composer.locator(".destination-list button").filter({ hasText: "Instagram" })).toBeEnabled();
  await expect(composer.locator(".destination-list button").filter({ hasText: "YouTube" })).toBeDisabled();
  await expect(composer.getByText("YouTube requires video")).toBeVisible();
});

test("mobile planner does not overflow the viewport shell", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only assertion");
  await page.goto("/demo?view=calendar");
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole("heading", { name: "August 2026" })).toBeVisible();
});
