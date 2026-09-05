import { expect, test } from "@playwright/test";

test("CLI docs are URL-backed and guide both installation modes", async ({ page }) => {
  await page.goto("/demo?view=docs");
  await expect(page).toHaveURL(/view=docs/);
  await expect(page.getByRole("heading", { name: /Give your agent/ })).toBeVisible();
  await expect(page.locator(".docs-section")).toHaveCount(6);
  await expect(page.getByText("npm install --global ./apps/cli", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /Repository-local/ }).click();
  await expect(page.getByText("pnpm relay -- --help", { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Open Settings" }).click();
  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
});

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

test("demo scheduling stays local and appears on the calendar", async ({ page }) => {
  let postWrites = 0;
  await page.route("**/api/v1/posts", async (route) => {
    if (route.request().method() !== "GET") postWrites += 1;
    await route.continue();
  });
  await page.goto("/demo?view=calendar");
  await page.getByRole("button", { name: /Create post/ }).first().click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await composer.getByLabel("Content").fill("A demo-only scheduled post");
  await composer.locator(".destination-list button").filter({ hasText: "Instagram" }).click();
  await composer.getByRole("button", { name: /Schedule post/ }).click();
  await expect(composer).toBeHidden();
  await expect(page.locator(".planning-event.scheduled").filter({ hasText: "A demo-only scheduled post" })).toBeVisible();
  expect(postWrites).toBe(0);
});

test("clicking a calendar day opens a post scheduled for that day", async ({ page }) => {
  await page.goto("/demo?view=calendar");
  const day = page.locator(".planning-days > section").filter({ has: page.locator("header b", { hasText: /^10$/ }) }).first();
  const expectedDate = await day.evaluate((element) => {
    const date = new Date(element.getAttribute("title")!.replace("Create a post on ", ""));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T09:30`;
  });
  await day.locator("header").click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.getByLabel(/Publish date and time/)).toHaveValue(expectedDate);
});

test("opening a completed calendar post does not create a draft and each card can be deleted", async ({ page }) => {
  let postMutations = 0;
  await page.route("**/api/v1/posts", async (route) => {
    if (route.request().method() === "POST") postMutations += 1;
    await route.fulfill({ status: 500, json: { error: "Unexpected post mutation" } });
  });
  await page.goto("/demo?view=calendar");
  const published = page.locator(".planning-event.published").first();
  await published.locator(".planning-event-main").click();
  await expect(page.getByRole("dialog", { name: "Create post" }).getByText("Post again")).toBeVisible();
  expect(postMutations).toBe(0);
  await page.keyboard.press("Escape");
  await published.getByRole("button", { name: "Delete published post" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete this post from Relay?");
});

test("scheduled and published posts can be duplicated into an editable composer", async ({ page }) => {
  await page.goto("/demo?view=posts");
  for (const status of ["scheduled", "published"] as const) {
    const row = page.locator(".post-row").filter({ has: page.locator(`.status.${status}`) }).first();
    const originalText = (await row.locator(".post-main p").textContent()) ?? "";
    await row.getByRole("button", { name: "Post actions" }).click();
    await row.getByRole("menuitem", { name: "Duplicate post" }).click();
    const composer = page.getByRole("dialog", { name: "Create post" });
    await expect(composer.getByText("Post again")).toBeVisible();
    await expect(composer.getByLabel("Content")).toHaveValue(originalText);
    await page.keyboard.press("Escape");
  }
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

test("composer creates and selects a campaign without leaving the post", async ({ page }) => {
  let createdCampaign: Record<string, unknown> | null = null;
  await page.route("**/api/v1/campaigns", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createdCampaign = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, json: { data: { id: "campaign-autumn", brandId: createdCampaign.brandId, name: createdCampaign.name, color: "#2563eb", status: "active", postCount: 0, createdAt: "2026-08-26T10:00:00.000Z", updatedAt: "2026-08-26T10:00:00.000Z" } } });
  });
  await page.goto("/demo?view=calendar");
  await page.getByRole("button", { name: /Create post/ }).first().click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await composer.getByRole("button", { name: "Create", exact: true }).click();
  const campaignDialog = page.getByRole("dialog", { name: "Create a campaign" });
  await campaignDialog.getByPlaceholder("e.g. September launch").fill("Autumn launch");
  await campaignDialog.getByRole("button", { name: "Create campaign" }).click();
  await expect(campaignDialog).toBeHidden();
  await expect(composer.getByLabel("Campaign")).toHaveValue("campaign-autumn");
  expect(createdCampaign).toMatchObject({ name: "Autumn launch", brandId: "brand-aster" });
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
  await expect(composer.locator(".social-preview")).toHaveClass(/format-reel/);
  await expect(composer.locator(".reel-topbar")).toContainText("For You");
  await expect(composer.locator(".preview-caption-text")).toHaveText("TikTok-specific launch caption");
  await expect(composer.locator(".social-preview .preview-account")).toHaveCount(0);
  await composer.locator(".preview-provider-tabs button").filter({ hasText: "Instagram" }).click();
  await composer.locator(".platform-card").filter({ hasText: "Instagram" }).getByLabel("Publish as").selectOption("reel");
  await expect(composer.locator(".social-preview")).toHaveClass(/format-reel/);
  await expect(composer.locator(".reel-topbar")).toContainText("Reels");
  await expect(composer.locator(".social-preview .preview-account")).toHaveCount(0);
  await composer.locator(".destination-list button").filter({ hasText: "YouTube" }).click();
  await composer.locator(".preview-provider-tabs button").filter({ hasText: "YouTube" }).click();
  await expect(composer.locator(".social-preview")).toHaveClass(/provider-youtube.*format-watch/);
  await expect(composer.locator(".youtube-watch-copy")).toBeVisible();
  await expect(composer.getByLabel(/Publish date and time in Europe\/Madrid/)).toBeVisible();
  await composer.locator(".brand-select button").filter({ hasText: "Field Notes" }).click();
  await composer.locator(".destination-list button").filter({ hasText: "Facebook" }).click();
  const facebookFormat = composer.locator(".platform-card").filter({ hasText: "Facebook" }).getByLabel("Publish as");
  await expect(facebookFormat).toHaveValue("feed");
  await expect(facebookFormat.locator('option[value="reel"]')).toHaveCount(0);
  await expect(composer.locator(".social-preview")).toHaveClass(/provider-facebook/);
  await expect(composer.locator(".social-preview")).not.toHaveClass(/format-reel/);
});

test("publishing defaults are configurable and flow into new posts", async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/v1/settings/publishing", async (route) => {
    saved = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { data: saved } });
  });
  await page.goto("/demo?view=settings");
  await page.getByRole("button", { name: "Publishing", exact: true }).click();
  await expect(page.getByLabel("Instagram video default")).toHaveValue("reel");
  await expect(page.getByLabel("Facebook image default")).toHaveValue("feed");
  await expect(page.getByLabel("Facebook image default")).toBeDisabled();
  await expect(page.getByLabel("Facebook video default")).toHaveValue("reel");
  await expect(page.getByLabel("TikTok visibility default")).toHaveValue("SELF_ONLY");
  await expect(page.getByLabel("YouTube visibility default")).toHaveValue("public");
  await page.getByLabel("YouTube visibility default").selectOption("private");
  await page.getByRole("button", { name: "Save publishing defaults" }).click();
  await expect(page.getByText("Defaults saved")).toBeVisible();
  expect(saved).toMatchObject({ youtube: { privacyStatus: "private", madeForKids: false } });
  await page.getByRole("button", { name: /Create post/ }).first().click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await composer.locator(".destination-list button").filter({ hasText: "YouTube" }).click();
  await expect(composer.locator(".platform-card").filter({ hasText: "YouTube" }).getByLabel("Visibility")).toHaveValue("private");
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
  let preparedUploads = 0;
  await page.route("**/api/v1/media/projects", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/media?**", (route) => route.fulfill({ json: { data: [], pagination: { nextCursor: null } } }));
  await page.route("**/api/v1/media", (route) => {
    preparedUploads += 1;
    return route.fulfill({ json: { uploadUrl: `https://upload.example.test/file-${preparedUploads}` } });
  });
  await page.route("https://upload.example.test/**", (route) => route.fulfill({ status: 200, body: "" }));
  await page.goto("/demo?view=media");
  await expect(page.getByRole("button", { name: /Upload to/ })).toBeVisible();
  const assetInput = page.locator('input[type="file"][multiple]');
  await expect(assetInput).toHaveAttribute("accept", "image/*,video/*");
  await assetInput.setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: Buffer.from("first") },
    { name: "second.mp4", mimeType: "video/mp4", buffer: Buffer.from("second") },
  ]);
  await expect.poll(() => preparedUploads).toBe(2);
  await expect(page.getByRole("button", { name: /New folder/ })).toBeVisible();
  await page.getByRole("button", { name: "Music" }).click();
  await expect(assetInput).toHaveAttribute("accept", "audio/*");
  await assetInput.setInputFiles([
    { name: "first.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("first") },
    { name: "second.wav", mimeType: "audio/wav", buffer: Buffer.from("second") },
  ]);
  await expect.poll(() => preparedUploads).toBe(4);
  await expect(page.getByRole("button", { name: /Unsorted/ })).toBeHidden();
});

test("R2 composer picker filters media types and jumps to the last page", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/v1/media/projects", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/media?**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const cursor = url.searchParams.get("cursor");
    const mediaType = url.searchParams.get("mediaType");
    if (mediaType !== "video") return route.fulfill({ json: { data: [], pagination: { nextCursor: null } } });
    const pageNumber = cursor === "page-3" ? 3 : cursor === "page-2" ? 2 : 1;
    return route.fulfill({ json: { data: [{ key: `media/clip-${pageNumber}.mp4`, name: `clip-${pageNumber}.mp4`, size: 1024, lastModified: null, etag: `${pageNumber}`, url: `https://media.example.com/clip-${pageNumber}.mp4` }], pagination: { nextCursor: pageNumber === 1 ? "page-2" : pageNumber === 2 ? "page-3" : null } } });
  });
  await page.goto("/demo?view=calendar");
  await page.getByRole("button", { name: /Create post/ }).first().click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await composer.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("button", { name: "Choose from library" }).click();
  const picker = page.getByRole("dialog", { name: "Choose from your library" });
  await picker.getByLabel("Media type").selectOption("video");
  await expect(picker.getByText("clip-1.mp4", { exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Last" }).click();
  await expect(picker.getByText("clip-3.mp4", { exact: true })).toBeVisible();
  await expect(picker.getByText("Page 3")).toBeVisible();
  expect(requests.some((query) => query.includes("mediaType=video") && query.includes("cursor=page-3"))).toBe(true);
});

test("media folders can be renamed and assets moved between them", async ({ page }) => {
  const sourceId = "11111111-1111-4111-8111-111111111111";
  const destinationId = "22222222-2222-4222-8222-222222222222";
  let renamedFolder; let movedMedia;
  await page.route("**/api/v1/media/projects", async (route) => {
    if (route.request().method() === "PATCH") {
      renamedFolder = route.request().postDataJSON();
      return route.fulfill({ json: { data: { id: sourceId, name: renamedFolder.name, kind: "media", count: 1, createdAt: "2026-08-20T10:00:00.000Z" } } });
    }
    return route.fulfill({ json: { data: [
      { id: sourceId, name: "Source assets", kind: "media", count: 1, createdAt: "2026-08-20T10:00:00.000Z" },
      { id: destinationId, name: "Destination assets", kind: "media", count: 0, createdAt: "2026-08-20T10:00:00.000Z" },
    ] } });
  });
  await page.route("**/api/v1/media", async (route) => {
    movedMedia = route.request().postDataJSON();
    return route.fulfill({ json: { key: `media-projects/${destinationId}/media/clip.png`, name: "clip.png", url: "https://media.example.com/moved.png" } });
  });
  await page.route("**/api/v1/media?**", async (route) => {
    return route.fulfill({ json: { data: [{ key: `media-projects/${sourceId}/media/clip.png`, name: "clip.png", size: 1200, lastModified: null, etag: "asset", url: "https://media.example.com/clip.png" }], pagination: { nextCursor: null } } });
  });
  await page.route("https://media.example.com/clip.png", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") }));

  await page.goto("/demo?view=media");
  await page.getByRole("button", { name: /Source assets/ }).click();
  await page.getByRole("button", { name: "Preview clip.png" }).click();
  const previewDialog = page.getByRole("dialog", { name: "clip.png" });
  await expect(previewDialog.getByRole("img", { name: "clip.png" })).toBeVisible();
  await expect(previewDialog.getByRole("link", { name: /Open original/ })).toHaveAttribute("href", "https://media.example.com/clip.png");
  await page.keyboard.press("Escape");
  await expect(previewDialog).toBeHidden();
  await page.getByRole("button", { name: "Rename folder" }).click();
  const renameDialog = page.getByRole("dialog", { name: "Rename asset folder" });
  await renameDialog.getByRole("textbox").fill("Renamed assets");
  await renameDialog.getByRole("button", { name: "Rename folder" }).click();
  await expect.poll(() => renamedFolder).toEqual({ id: sourceId, name: "Renamed assets" });

  await page.getByRole("button", { name: "Move clip.png" }).click();
  await page.getByLabel("Destination folder").selectOption(destinationId);
  await page.getByRole("button", { name: "Move file" }).click();
  await expect.poll(() => movedMedia).toEqual({ key: `media-projects/${sourceId}/media/clip.png`, projectId: destinationId, kind: "media" });
});

test("media folders can be nested and moved with drag and drop", async ({ page }) => {
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const destinationId = "44444444-4444-4444-8444-444444444444";
  let movedFolder: Record<string, unknown> | undefined;
  const folders = [
    { id: sourceId, name: "Source assets", kind: "media", count: 1, createdAt: "2026-08-20T10:00:00.000Z", parentId: null },
    { id: destinationId, name: "Destination assets", kind: "media", count: 0, createdAt: "2026-08-20T10:00:00.000Z", parentId: null },
  ];
  await page.route("**/api/v1/media/projects", async (route) => {
    if (route.request().method() === "PATCH") {
      movedFolder = route.request().postDataJSON() as Record<string, unknown>;
      const source = folders[0];
      return route.fulfill({ json: { data: { ...source, parentId: movedFolder.parentId } } });
    }
    return route.fulfill({ json: { data: folders } });
  });
  await page.route("**/api/v1/media?**", (route) => route.fulfill({ json: { data: [], pagination: { nextCursor: null } } }));

  await page.goto("/demo?view=media");
  const source = page.getByRole("button", { name: /Source assets/ });
  const destination = page.getByRole("button", { name: /Destination assets/ });
  await expect(source).toHaveAttribute("draggable", "true");
  await source.dragTo(destination);
  await expect.poll(() => movedFolder).toEqual({ id: sourceId, parentId: destinationId });
  await expect(page.getByText("Source assets moved inside Destination assets.")).toBeVisible();
  await expect(source).toHaveCSS("margin-left", "18px");
});

test("selected media can be scheduled as a daily sequence", async ({ page }) => {
  await page.goto("/demo?view=media");
  await page.getByRole("button", { name: "Select aster-ritual.svg" }).click();
  await page.getByRole("button", { name: "Select launch-decisions.svg" }).click();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: /Schedule sequence/ }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule a media sequence" });
  await expect(dialog.locator(".sequence-list article")).toHaveCount(2);
  await dialog.getByLabel("Cadence").selectOption("2");
  await dialog.locator(".batch-account").filter({ hasText: "Instagram" }).getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Schedule 2 posts" }).click();
  await expect(page.getByText("2 demo posts added to the sequence preview.")).toBeVisible();
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
  const mediaMutations: Array<{ method: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/v1/videos", (route) => route.fulfill({ json: { data: route.request().method() === "GET" ? [project] : { ...project, ...route.request().postDataJSON() } } }));
  await page.route("**/api/v1/videos/batch", (route) => route.fulfill({ status: 201, json: { summary: { created: 2, failed: 0 } } }));
  await page.route("**/api/v1/videos/render", (route) => route.fulfill({ json: { data: { ...project, sourceUrl: "https://media.example.com/device.mp4", renderedUrl: "https://media.example.com/hook-reel.mp4" }, folder: { id: "video-output", name: "Hook reel · render" } } }));
  await page.route("**/api/v1/media/projects", (route) => route.fulfill({ json: { data: [{ id: "media-folder", name: "Aster clips", kind: "media", count: 1, createdAt: "2026-08-20T10:00:00.000Z" }, { id: "music-folder", name: "Launch music", kind: "music", count: 3, createdAt: "2026-08-20T10:00:00.000Z" }] } }));
  await page.route("**/api/v1/media", (route) => { const method = route.request().method(); const body = route.request().postDataJSON() as Record<string, unknown> | null; if (body) mediaMutations.push({ method, body }); return route.fulfill({ json: { key: method === "POST" ? "staging/user/media/device.mp4" : "media-projects/media-folder/media/device.mp4", uploadUrl: "https://upload.example.test/device.mp4", url: "https://media.example.com/device.mp4" } }); });
  await page.route("**/api/v1/media?**", (route) => route.request().method() === "POST" ? route.fulfill({ json: { key: "media-folder/device.mp4", uploadUrl: "https://upload.example.test/device.mp4", url: "https://media.example.com/device.mp4" } }) : route.fulfill({ json: { data: route.request().url().includes("kind=music") ? [{ key: "music-folder/track.mp3", name: "track.mp3", url: "https://media.example.com/track.mp3", kind: "music" }] : [{ key: "media-folder/source.mp4", name: "source.mp4", url: "https://media.example.com/source.mp4", kind: "media" }] } }));
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
  await expect(page.getByText("device.mp4 is uploaded temporarily and will be added to Media when you save.")).toBeVisible();
  expect(mediaMutations.find((request) => request.method === "POST")?.body.staged).toBe(true);
  await expect(page.locator(".video-label-canvas > video")).toHaveAttribute("controls", "");
  await expect(page.locator(".video-label-canvas .creative-label")).toBeVisible();
  await expect(page.getByText("Drag any label directly on the video")).toBeVisible();
  await expect(page.locator(".label-style-shortcuts button")).toHaveCount(3);
  await expect(page.getByLabel("Label text color")).toHaveValue("#ffffff");
  await expect(page.getByLabel("Label background color")).toHaveValue("#000000");
  await expect(page.getByLabel("Label font")).toHaveValue("modern");
  await page.getByLabel("Label font").selectOption("editorial");
  await expect(page.getByLabel("Label font")).toHaveValue("editorial");
  await expect(page.getByLabel("Label minimum height")).toHaveValue("12");
  await page.getByLabel("Label minimum height").fill("20");
  await expect(page.getByLabel("Label minimum height")).toHaveValue("20");
  await expect(page.locator(".video-label-canvas .creative-label")).toHaveAttribute("style", /min-height: 20%/);
  await page.getByLabel("Label text", { exact: true }).fill("A longer hook that wraps onto several lines and makes its background grow with the full message");
  await expect.poll(() => page.locator(".video-label-canvas").evaluate((canvas) => canvas.querySelector<HTMLElement>(".creative-label")!.offsetHeight / (canvas as HTMLElement).offsetHeight)).toBeGreaterThan(.2);
  await page.getByRole("button", { name: "Add label" }).click();
  await expect(page.locator(".video-label-tabs button")).toHaveCount(2);
  await page.getByRole("button", { name: "White / clear" }).click();
  await expect(page.getByRole("button", { name: "White / clear" })).toHaveClass(/active/);
  await page.getByLabel("Video music folder").selectOption("music-folder");
  await page.getByLabel("Video music track").selectOption("https://media.example.com/track.mp3");
  await expect(page.locator(".video-preview-music")).toHaveAttribute("src", "https://media.example.com/track.mp3");
  await expect(page.getByText("Play the video preview to hear this track with the hook.")).toBeVisible();
  const videoHandoff = page.locator(".video-inspector .slideshow-handoff");
  await expect(videoHandoff.getByLabel("Brand")).toHaveCount(0);
  await expect(videoHandoff.getByLabel("Caption")).toHaveCount(0);
  await page.getByRole("button", { name: /Bulk hooks/ }).click();
  await expect(page.getByRole("dialog", { name: "Turn hooks into scheduled videos" })).toBeVisible();
  await expect(page.getByText("One song for all")).toBeVisible();
  await expect(page.getByText("Different in order")).toBeVisible();
  await expect(page.getByText("Random from source")).toBeVisible();
  await page.getByText("One song for all").click();
  await expect(page.getByLabel("Batch music source").locator('option[value="all"]')).toHaveText("All music");
  await expect(page.getByLabel("Batch music source").locator('option[value="unfiled"]')).toHaveText("General music (no folder)");
  await page.getByLabel("Batch music source").selectOption("unfiled");
  await page.getByLabel("Batch music track").selectOption("https://media.example.com/track.mp3");
  await page.getByText("Different in order").click();
  await expect(page.getByLabel("Batch music source")).toHaveValue("unfiled");
  await expect(page.getByText("1 track available from this source")).toBeVisible();
  await page.getByRole("button", { name: "Create batch" }).click();
  await expect(page.locator(".video-batch-error")).toContainText("Add at least one hook");
  await page.getByLabel(/Hooks/).fill("First hook\nSecond hook");
  await page.getByRole("button", { name: "Create batch" }).click();
  await expect(page.getByText("2 videos created in R2.")).toBeVisible();
  expect(mediaMutations.find((request) => request.method === "PATCH")?.body.commit).toBe(true);
  await videoHandoff.getByRole("button", { name: "Create post" }).click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.getByText("Hook reel.mp4")).toBeVisible();
  await expect(composer.getByRole("group", { name: /Brand/ })).toBeVisible();
  await expect(composer.locator(".destination-list button").filter({ hasText: "Instagram" })).toBeEnabled();
  await expect(composer.locator(".destination-list button").filter({ hasText: "YouTube" })).toBeEnabled();
  await composer.locator(".destination-list button").filter({ hasText: "Instagram" }).click();
  await expect(composer.locator(".platform-card").filter({ hasText: "Instagram" }).getByLabel("Publish as")).toHaveValue("reel");
  await composer.locator(".destination-list button").filter({ hasText: "YouTube" }).click();
  const youtubeCard = composer.locator(".platform-card").filter({ hasText: "YouTube" });
  await expect(youtubeCard.getByText("Custom thumbnail", { exact: true })).toBeVisible();
  await expect(youtubeCard.getByRole("button", { name: "Choose frame" })).toBeVisible();
  await expect(youtubeCard.getByRole("button", { name: "Upload image" })).toBeVisible();
  await expect(youtubeCard.getByRole("button", { name: "Media folder" })).toBeVisible();
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
  await expect(page.getByLabel("Label minimum height")).toHaveValue("12");
  await page.getByLabel("Label text color").fill("#ff5c35");
  await page.getByLabel("Label background color").fill("#123456");
  await expect(page.locator(".slide-stage .slide-title")).toHaveAttribute("style", /background-color: rgb\(18, 52, 86\)/);
  await page.getByLabel("Label minimum height").fill("20");
  await expect(page.locator(".slide-stage .slide-title")).toHaveAttribute("style", /min-height: 20%/);
  await page.getByLabel("Label text", { exact: true }).fill("A longer slideshow title that wraps onto several lines and keeps the complete background behind it");
  await expect.poll(() => page.locator(".slide-stage .slide-canvas").evaluate((canvas) => canvas.querySelector<HTMLElement>(".slide-title")!.offsetHeight / (canvas as HTMLElement).offsetHeight)).toBeGreaterThan(.2);
  await page.locator(".slideshow-handoff").getByRole("button", { name: "Create post" }).click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.getByText("2 ordered slides ready")).toBeVisible();
  await expect(composer.locator(".destination-list button").filter({ hasText: "Instagram" })).toBeEnabled();
  await expect(composer.locator(".destination-list button").filter({ hasText: "YouTube" })).toBeDisabled();
  await expect(composer.getByText("YouTube requires video")).toBeVisible();
});

test("slideshow accepts dropped image files", async ({ page }) => {
  const stagedUploads: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/media?**", (route) => route.fulfill({ json: { data: [], pagination: { nextCursor: null } } }));
  await page.route("**/api/v1/media/projects?**", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/media/sources", (route) => route.fulfill({ json: { configured: false } }));
  await page.route("**/api/v1/media", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    stagedUploads.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, json: { key: "staging/demo/dropped.png", uploadUrl: "https://upload.example.com/dropped.png", url: "https://media.example.com/dropped.png", staged: true } });
  });
  await page.route("https://upload.example.com/dropped.png", (route) => route.fulfill({ status: 200 }));

  await page.goto("/demo?view=slideshows");
  await page.getByRole("button", { name: /Launch story/ }).first().click();
  await page.getByRole("button", { name: "Add images" }).click();
  const picker = page.getByRole("dialog", { name: "Add images to the slideshow" });
  const dropZone = picker.locator(".slideshow-upload-source");
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["drop test"], "dropped.png", { type: "image/png" }));
    return transfer;
  });

  await dropZone.dispatchEvent("dragenter", { dataTransfer });
  await dropZone.dispatchEvent("dragover", { dataTransfer });
  await expect(dropZone).toHaveClass(/drag-active/);
  await dropZone.dispatchEvent("drop", { dataTransfer });

  await expect.poll(() => stagedUploads.length).toBe(1);
  expect(stagedUploads[0]).toMatchObject({ fileName: "dropped.png", contentType: "image/png", staged: true });
  await expect(page.locator(".slide-rail > button:not(.add-slide)")).toHaveCount(4);
});

test("slideshow imports photos with the server-configured Pexels key", async ({ page }) => {
  const imports: Array<Record<string, unknown>> = [];
  const searchBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/media?**", (route) => route.fulfill({ json: { data: [], pagination: { nextCursor: null } } }));
  await page.route("**/api/v1/media/projects?**", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/media/sources", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { configured: true } });
    const body = route.request().postDataJSON() as { provider: "pexels"; page: number };
    searchBodies.push(body);
    const item = body.page === 1
      ? { id: "pexels-42", provider: "pexels", title: "A quiet workspace", previewUrl: "https://images.pexels.com/photos/42/preview.jpeg", importUrl: "https://images.pexels.com/photos/42/original.jpeg", sourceUrl: "https://www.pexels.com/photo/42", creator: "Ari", creatorUrl: "https://www.pexels.com/@ari", attribution: "Photo by Ari on Pexels" }
      : { id: "pexels-43", provider: "pexels", title: "A second workspace", previewUrl: "https://images.pexels.com/photos/43/preview.jpeg", importUrl: "https://images.pexels.com/photos/43/original.jpeg", sourceUrl: "https://www.pexels.com/photo/43", creator: "Sam", creatorUrl: "https://www.pexels.com/@sam", attribution: "Photo by Sam on Pexels" };
    return route.fulfill({ json: { provider: body.provider, page: body.page, hasMore: body.page === 1, items: [item] } });
  });
  await page.route("**/api/v1/media/import", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>; imports.push(body);
    return route.fulfill({ status: 201, json: { key: `staging/demo/media/${body.id}.jpg`, url: `https://media.example.com/${body.id}.jpg`, staged: true } });
  });
  await page.route("https://images.pexels.com/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") }));

  await page.goto("/demo?view=slideshows");
  await page.getByRole("button", { name: /Launch story/ }).first().click();
  await page.getByRole("button", { name: "Add images" }).click();
  const picker = page.getByRole("dialog", { name: "Add images to the slideshow" });
  await picker.getByRole("button", { name: "Pexels" }).click();
  await picker.getByLabel("Search Pexels").fill("quiet workspace");
  await picker.getByRole("button", { name: "Search" }).click();
  await picker.locator(".external-media-grid article").filter({ hasText: "A quiet workspace" }).getByRole("button", { name: /Add/ }).click();
  await picker.getByRole("button", { name: "Load more photos" }).click();
  await expect(picker.getByText("A second workspace")).toBeVisible();
  await expect(picker.getByRole("button", { name: "Load more photos" })).toHaveCount(0);
  await expect.poll(() => imports.length).toBe(1);
  expect(searchBodies).toEqual([
    { provider: "pexels", query: "quiet workspace", page: 1 },
    { provider: "pexels", query: "quiet workspace", page: 2 },
  ]);
  expect(imports[0]).toMatchObject({ provider: "pexels" });
  await expect(page.locator(".slide-rail > button:not(.add-slide)")).toHaveCount(4);
});

test("slideshow explains how to configure a missing Pexels key", async ({ page }) => {
  await page.route("**/api/v1/media?**", (route) => route.fulfill({ json: { data: [], pagination: { nextCursor: null } } }));
  await page.route("**/api/v1/media/projects?**", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/media/sources", (route) => route.fulfill({ json: { configured: false } }));
  await page.goto("/demo?view=slideshows");
  await page.getByRole("button", { name: /Launch story/ }).first().click();
  await page.getByRole("button", { name: "Add images" }).click();
  const picker = page.getByRole("dialog", { name: "Add images to the slideshow" });
  await picker.getByRole("button", { name: "Pexels" }).click();
  await expect(picker.getByText("Pexels API key required")).toBeVisible();
  await expect(picker.getByText(/PEXELS_API_KEY=your_key/)).toBeVisible();
  await expect(picker.getByLabel("Search Pexels")).toHaveCount(0);
});

test("mobile planner does not overflow the viewport shell", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only assertion");
  await page.goto("/demo?view=calendar");
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole("heading", { name: "August 2026" })).toBeVisible();
});
