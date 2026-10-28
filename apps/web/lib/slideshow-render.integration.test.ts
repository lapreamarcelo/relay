import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import type { VideoTimeline } from "@relay/core";

// All SQL, transactions, constraints, and migrations are real. Only authentication,
// object storage and image/video encoders are local adapters; no production service
// can be contacted. A new schema is removed after each run.
test("slideshow video migration, durable render transactions, and concurrent edits work in PostgreSQL", { skip: !process.env.RELAY_PUBLISHING_TEST_DATABASE_URL }, async t => {
  const databaseUrl = process.env.RELAY_PUBLISHING_TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname), "Use a disposable local PostgreSQL server");
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_POOL_SIZE = "1";
  let beforeSourceSave: (() => Promise<void>) | undefined;
  let encoded = 0;
  let stored = 0;
  let encoderError: Error | undefined;
  const objects = new Set<string>();
  const adapter = {
    r2: { send: async (command: { input: { Key?: string; Delete?: { Objects: Array<{ Key: string }> } } }) => {
      if (command.input.Delete) for (const object of command.input.Delete.Objects) objects.delete(object.Key);
      else if (command.input.Key) { stored++; objects.add(command.input.Key); }
      return {};
    } },
    flatten: async () => {
      if (beforeSourceSave) { const update = beforeSourceSave; beforeSourceSave = undefined; await update(); }
      return Buffer.from("flattened-image");
    },
    render: async (input: { timeline: VideoTimeline; targetKey: string }) => {
      encoded++;
      objects.add(input.targetKey); objects.add(input.targetKey.replace(/\.mp4$/, ".jpg"));
      if (encoderError) throw encoderError;
      return { url: `https://media.example.test/${input.targetKey}`, coverUrl: `https://media.example.test/${input.targetKey.replace(/\.mp4$/, ".jpg")}`, durationMs: input.timeline.clips.reduce((sum, clip) => sum + clip.outMs - clip.inMs, 0) };
    },
  };
  Object.assign(globalThis, { __relaySlideshowIntegrationAdapter: adapter });
  registerHooks({ resolve(specifier, context, next) {
    let code: string | undefined;
    if (specifier.endsWith("/api-session")) code = "export async function requireApiSession(){return{session:{user:{id:'owner'}},response:null}}";
    else if (specifier.endsWith("/r2")) code = "export const getR2Client=()=>globalThis.__relaySlideshowIntegrationAdapter.r2;export const getR2Config=()=>({bucket:'local',publicUrl:'https://media.example.test'});export const publicObjectUrl=key=>'https://media.example.test/'+key";
    else if (specifier.endsWith("/slideshow-renderer")) code = "export const renderSlideshowImage=globalThis.__relaySlideshowIntegrationAdapter.flatten";
    else if (specifier.endsWith("/video-renderer")) code = "export const renderVideoArtifactDetails=globalThis.__relaySlideshowIntegrationAdapter.render";
    if (code) return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
    try { return next(specifier, context); }
    catch (error) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context); throw error; }
  } });
  const { sql } = await import("@relay/database");
  const crud = await import("../app/api/v1/slideshows/route.ts");
  const { POST: render } = await import("../app/api/v1/slideshows/render/route.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("source-image");
  const schemaName = `slideshow_render_${randomUUID().replaceAll("-", "")}`;
  const migrations = new URL("../../../packages/database/drizzle/", import.meta.url);
  const slides = [
    { id: "second", mediaUrl: "https://media.example.test/second.png", text: "First slide", fit: "contain", textPosition: "center", textSize: 64, textFont: "modern", textColor: "#FFFFFF", textBackground: "dark", deviceFrame: { device: "phone", color: "#202020", background: "#123456" } },
    { id: "first", mediaUrl: "https://media.example.test/first.png", text: "Second slide", fit: "cover", textPosition: "bottom", textSize: 64, textFont: "modern", textColor: "#FFFFFF", textBackground: "dark" },
  ];
  const request = (body: unknown) => new Request("https://relay.test/api/v1/slideshows/render", { method: "POST", body: JSON.stringify(body) });
  const reset = async () => {
    beforeSourceSave = undefined; encoded = 0; stored = 0; encoderError = undefined; objects.clear();
    await sql`DELETE FROM video_project`;
    await sql`DELETE FROM slideshow_project`;
    await sql`INSERT INTO slideshow_project (id, owner_id, brand_id, name, caption, slides, output)
      VALUES ('slideshow', 'owner', 'brand', 'Launch', 'Original caption', ${JSON.stringify(slides)}::jsonb, '{"format":"video","imageSeconds":3}'::jsonb)`;
  };
  try {
    await sql.unsafe(`CREATE SCHEMA ${schemaName}`);
    await sql.unsafe(`SET search_path TO ${schemaName}`);
    for (const file of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) await sql.unsafe(await readFile(new URL(file, migrations), "utf8"));
    await sql`INSERT INTO "user" (id, name, email) VALUES ('owner', 'Owner', 'slideshow-owner@example.test')`;
    await sql`INSERT INTO brand (id, owner_id, name, monogram, color) VALUES ('brand', 'owner', 'Brand', 'B', '#123456')`;

    await t.test("0026 is idempotent and omitted output defaults to images", async () => {
      await sql.unsafe(await readFile(new URL("0026_slideshow_output.sql", migrations), "utf8"));
      await sql`INSERT INTO slideshow_project (id, owner_id, name) VALUES ('legacy', 'owner', 'Legacy')`;
      assert.deepEqual((await sql`SELECT output FROM slideshow_project WHERE id = 'legacy'`)[0].output, { format: "images" });
      assert.equal((await sql`SHOW timezone`)[0].TimeZone, "UTC");
    });

    await t.test("CRUD stores output and a PATCH omission preserves it in SQL", async () => {
      const created = await crud.POST(request({ name: "Persisted output", brandId: "brand", slides, output: { format: "video", imageSeconds: 4 } }));
      assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
      const { data } = await created.json();
      const patched = await crud.PATCH(request({ id: data.id, name: "Edited", brandId: "brand", slides }));
      assert.equal(patched.status, 200);
      assert.deepEqual((await sql`SELECT output FROM slideshow_project WHERE id = ${data.id}`)[0].output, { format: "video", imageSeconds: 4 });
    });

    await t.test("async video output commits source images, video project, and a normal durable job atomically", async () => {
      await reset();
      const response = await render(request({ id: "slideshow", async: true }));
      assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
      const result = await response.json();
      const [video] = await sql`SELECT * FROM video_project WHERE id = ${result.video.projectId}`;
      const [job] = await sql`SELECT * FROM video_render_job WHERE id = ${result.job.id}`;
      const [source] = await sql`SELECT * FROM slideshow_project WHERE id = 'slideshow'`;
      assert.equal(result.video.durationMs, 6000); assert.equal(result.folder.id, job.id);
      assert.equal(video.owner_id, "owner"); assert.equal(video.brand_id, "brand"); assert.equal(video.caption, "Original caption");
      assert.equal(video.source_folder_id, result.folder.id); assert.equal(video.revision, 1);
      assert.equal(job.owner_id, "owner"); assert.equal(job.project_id, video.id); assert.equal(job.revision, 1);
      assert.equal(job.kind, "render"); assert.equal(job.status, "queued"); assert.equal(job.progress, 0); assert.equal(job.attempts, 0);
      assert.equal(job.snapshot.id, video.id); assert.deepEqual(job.snapshot.timeline, video.timeline);
      assert.deepEqual(video.timeline.clips.map((clip: { sourceUrl: string }) => clip.sourceUrl), source.slides.map((slide: { renderedUrl: string }) => slide.renderedUrl));
      assert.deepEqual(source.slides.map((slide: { id: string }) => slide.id), ["second", "first"]);
      assert.equal(encoded, 0); assert.equal(stored, 3);
      await sql`DELETE FROM video_project WHERE id = ${video.id}`;
      assert.equal((await sql`SELECT id FROM video_render_job WHERE id = ${job.id}`).length, 0, "the normal job foreign key cascades with its derived video project");
    });

    await t.test("synchronous video output persists the rendered URL and cover on its reusable project", async () => {
      await reset();
      const response = await render(request({ id: "slideshow" }));
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const result = await response.json();
      const [video] = await sql`SELECT rendered_url, rendered_cover_url FROM video_project WHERE id = ${result.video.projectId}`;
      assert.equal(video.rendered_url, result.video.url); assert.equal(video.rendered_cover_url, result.video.coverUrl);
      assert.equal((await sql`SELECT id FROM video_render_job`).length, 0); assert.equal(encoded, 1);
    });

    await t.test("source compare-and-set rejects concurrent edits in image and video paths without a stale project or job", async () => {
      for (const format of ["images", "video"]) {
        for (const field of ["slides", "name", "caption", "brand", "output"]) {
          await reset();
          beforeSourceSave = async () => {
            if (field === "slides") await sql`UPDATE slideshow_project SET slides = jsonb_set(slides, '{0,text}', '"New text from another tab"'::jsonb) WHERE id = 'slideshow'`;
            if (field === "name") await sql`UPDATE slideshow_project SET name = 'New name' WHERE id = 'slideshow'`;
            if (field === "caption") await sql`UPDATE slideshow_project SET caption = 'New caption' WHERE id = 'slideshow'`;
            if (field === "brand") await sql`UPDATE slideshow_project SET brand_id = NULL WHERE id = 'slideshow'`;
            if (field === "output") await sql`UPDATE slideshow_project SET output = '{"format":"images"}'::jsonb WHERE id = 'slideshow'`;
          };
          const response = await render(request({ id: "slideshow", format, ...(format === "video" ? { async: true } : {}) }));
          assert.equal(response.status, 409, `${format}: ${field}: ${JSON.stringify(await response.clone().json())}`);
          assert.equal((await sql`SELECT id FROM video_project`).length, 0);
          assert.equal((await sql`SELECT id FROM video_render_job`).length, 0);
          assert.equal(encoded, 0);
          assert.equal(objects.size, 0, "failed renders remove only their newly created storage folder");
          if (field === "slides") assert.equal((await sql`SELECT slides FROM slideshow_project WHERE id = 'slideshow'`)[0].slides[0].text, "New text from another tab");
        }
      }
    });

    await t.test("synchronous encoding failure leaves source data unchanged and no draft video or media folder", async () => {
      await reset(); encoderError = new Error("Synchronous encoding failed");
      const originalError = console.error; console.error = () => {};
      try { assert.equal((await render(request({ id: "slideshow" }))).status, 500); }
      finally { console.error = originalError; }
      assert.deepEqual((await sql`SELECT slides FROM slideshow_project WHERE id = 'slideshow'`)[0].slides, slides);
      assert.equal((await sql`SELECT id FROM video_project`).length, 0);
      assert.equal((await sql`SELECT id FROM video_render_job`).length, 0);
      assert.equal(objects.size, 0);
    });

    await t.test("a concurrent edit after sync encoding returns 409 and leaves no derived project", async () => {
      await reset();
      beforeSourceSave = async () => { await sql`UPDATE slideshow_project SET caption = 'Another tab' WHERE id = 'slideshow'`; };
      const response = await render(request({ id: "slideshow" }));
      assert.equal(response.status, 409); assert.equal(encoded, 1);
      assert.equal((await sql`SELECT caption FROM slideshow_project WHERE id = 'slideshow'`)[0].caption, "Another tab");
      assert.equal((await sql`SELECT id FROM video_project`).length, 0);
      assert.equal(objects.size, 0);
    });

    await t.test("a job insertion failure rolls back the source update and derived project", async () => {
      await reset();
      await sql`ALTER TABLE video_render_job ADD CONSTRAINT reject_slideshow_job CHECK (kind <> 'render') NOT VALID`;
      const originalError = console.error; console.error = () => {};
      try { assert.equal((await render(request({ id: "slideshow", async: true }))).status, 500); }
      finally { console.error = originalError; await sql`ALTER TABLE video_render_job DROP CONSTRAINT reject_slideshow_job`; }
      assert.deepEqual((await sql`SELECT slides FROM slideshow_project WHERE id = 'slideshow'`)[0].slides, slides);
      assert.equal((await sql`SELECT id FROM video_project`).length, 0);
      assert.equal((await sql`SELECT id FROM video_render_job`).length, 0);
      assert.equal(objects.size, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await sql.unsafe(`DROP SCHEMA ${schemaName} CASCADE`);
    await sql.end();
  }
});
