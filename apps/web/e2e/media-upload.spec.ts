import { expect, test, type Page } from "@playwright/test";

const mediaFolder = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const musicFolder = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
type Upload = { fileName: string; contentType: string; kind: string; projectId?: string; mode: "signed" | "server" };

async function mockUploads(page: Page, options: { holdPut?: Promise<void>; failPut?: boolean } = {}) {
  const requests: Upload[] = [];
  const pending = new Map<string, Upload>();
  const assets: Array<{ key: string; name: string; kind: string; url: string; size: number; lastModified: null; etag: null; postUsage: { scheduled: number; published: number; publishing: number } }> = [];
  const add = (upload: Upload, id: string) => assets.push({ key: `media-projects/${upload.projectId}/${upload.kind}/${id}`, name: upload.fileName, kind: upload.kind, url: "/demo/post-1.svg", size: 100, lastModified: null, etag: null, postUsage: { scheduled: 0, published: 0, publishing: 0 } });
  await page.route("**/api/v1/media/projects", (route) => route.fulfill({ json: { data: [
    { id: mediaFolder, name: "Launch assets", kind: "media", count: 0, createdAt: new Date().toISOString() },
    { id: musicFolder, name: "Soundtracks", kind: "music", count: 0, createdAt: new Date().toISOString() },
  ] } }));
  await page.route(/\/api\/v1\/media\?/, (route) => route.fulfill({ json: { data: assets.filter((asset) => asset.kind === new URL(route.request().url()).searchParams.get("kind")), pagination: { nextCursor: null } } }));
  await page.route("**/api/v1/media", async (route) => {
    const id = String(requests.length);
    const contentType = route.request().headers()["content-type"];
    if (contentType.startsWith("multipart/form-data")) {
      const form = await new Response(route.request().postDataBuffer()!, { headers: { "Content-Type": contentType } }).formData();
      const file = form.get("file") as File;
      const upload: Upload = { fileName: file.name, contentType: file.type, kind: String(form.get("kind")), projectId: String(form.get("projectId")), mode: "server" };
      requests.push(upload); add(upload, id);
      return route.fulfill({ status: 201, json: { key: id, name: file.name, url: "/demo/post-1.svg" } });
    }
    const upload: Upload = { ...route.request().postDataJSON(), mode: "signed" };
    requests.push(upload); pending.set(id, upload);
    return route.fulfill({ json: { uploadUrl: `/test-upload/${id}` } });
  });
  await page.route("**/test-upload/*", async (route) => {
    await options.holdPut;
    if (options.failPut) return route.fulfill({ status: 503, body: "Upload unavailable" });
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    add(pending.get(id)!, id);
    return route.fulfill({ status: 200, body: "" });
  });
  return requests;
}

async function draggedFiles(page: Page, files: Array<{ name: string; type: string }>) {
  return page.evaluateHandle((items) => {
    const transfer = new DataTransfer();
    for (const item of items) transfer.items.add(new File(["asset"], item.name, { type: item.type }));
    return transfer;
  }, files);
}

test("drops multiple media into the selected folder and ignores repeat drops while uploading", async ({ page }) => {
  let finishPut!: () => void;
  const holdPut = new Promise<void>((resolve) => { finishPut = resolve; });
  const requests = await mockUploads(page, { holdPut });
  await page.goto("/demo?view=media");
  await page.locator(".media-folder-node").filter({ hasText: "Launch assets" }).click();
  const library = page.locator(".media-library");
  const dropzone = page.locator(".media-upload-dropzone");
  const transfer = await draggedFiles(page, [{ name: "Café launch.png", type: "image/png" }, { name: "Launch final.mp4", type: "video/mp4" }]);
  await dropzone.dispatchEvent("dragenter", { dataTransfer: transfer });
  await dropzone.locator("b").dispatchEvent("dragenter", { dataTransfer: transfer });
  await dropzone.locator("b").dispatchEvent("dragleave", { dataTransfer: transfer });
  await expect(dropzone).toHaveClass(/drag-active/);
  await expect(dropzone).toContainText("Drop to upload to Launch assets");
  await dropzone.dispatchEvent("dragleave", { dataTransfer: transfer });
  await expect(dropzone).not.toHaveClass(/drag-active/);
  await page.locator(".media-folder-node").filter({ hasText: "Launch assets" }).dispatchEvent("dragover", { dataTransfer: transfer });
  await page.locator(".media-folder-node").filter({ hasText: "Launch assets" }).dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dropzone).toBeDisabled();
  await expect.poll(() => requests.length).toBe(1);
  await library.dispatchEvent("drop", { dataTransfer: transfer });
  expect(requests).toHaveLength(1);
  finishPut();
  await expect(dropzone).toBeEnabled();
  expect(requests).toEqual([
    { fileName: "Café launch.png", contentType: "image/png", kind: "media", projectId: mediaFolder, mode: "signed" },
    { fileName: "Launch final.mp4", contentType: "video/mp4", kind: "media", projectId: mediaFolder, mode: "signed" },
  ]);
  await expect(page.locator(".media-grid > article")).toHaveCount(2);
  await expect(page.locator(".media-grid b")).toHaveText(["Café launch.png", "Launch final.mp4"]);
  const chooser = page.waitForEvent("filechooser");
  await dropzone.click();
  expect((await chooser).isMultiple()).toBe(true);
});

test("music drops validate file types, retain names, and use the server fallback", async ({ page }) => {
  const requests = await mockUploads(page, { failPut: true });
  await page.goto("/demo?view=media");
  await page.getByRole("button", { name: "Music", exact: true }).click();
  await page.locator(".media-folder-node").filter({ hasText: "Soundtracks" }).click();
  const library = page.locator(".media-library");
  const textDrag = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.setData("text/plain", "a folder or text"); return transfer; });
  await library.dispatchEvent("dragenter", { dataTransfer: textDrag });
  await expect(library).not.toHaveClass(/media-file-drag/);
  await library.dispatchEvent("drop", { dataTransfer: textDrag });
  expect(requests).toHaveLength(0);
  const image = await draggedFiles(page, [{ name: "Wrong image.png", type: "image/png" }]);
  await library.dispatchEvent("drop", { dataTransfer: image });
  await expect(page.locator(".media-error")).toContainText("choose an audio file in Music");
  expect(requests).toHaveLength(0);
  const song = await draggedFiles(page, [{ name: "Mi canción 🎵.mp3", type: "audio/mpeg" }]);
  await library.dispatchEvent("drop", { dataTransfer: song });
  await expect(page.locator(".media-upload-dropzone")).toBeEnabled();
  await expect(page.locator(".media-grid b")).toHaveText(["Mi canción 🎵.mp3"]);
  expect(requests.map(({ mode, ...upload }) => ({ mode, ...upload }))).toEqual([
    { fileName: "Mi canción 🎵.mp3", contentType: "audio/mpeg", kind: "music", projectId: musicFolder, mode: "signed" },
    { fileName: "Mi canción 🎵.mp3", contentType: "audio/mpeg", kind: "music", projectId: musicFolder, mode: "server" },
  ]);
  await expect(page.locator(".media-error")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
