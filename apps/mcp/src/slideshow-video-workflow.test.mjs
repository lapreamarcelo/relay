import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
register();
const { createRelayMcpServer } = await import("./server.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const urls = ["https://media.example/second.jpg", "https://media.example/first.jpg"];
const videoUrl = "https://media.example/slideshow.mp4";
const project = { id: "slides", brandId: "brand", caption: "Launch", slides: urls.map(renderedUrl => ({ renderedUrl })) };
const targets = [
  { accountId: "instagram", settings: { kind: "instagram", publishType: "reel" } },
  { accountId: "facebook", settings: { kind: "facebook", publishType: "reel" } },
  { accountId: "tiktok", settings: { kind: "tiktok", privacyLevel: "PUBLIC_TO_EVERYONE" } },
  { accountId: "youtube", settings: { kind: "youtube", title: "Launch" } },
];

async function session(handler, callback) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { path: new URL(url).pathname + new URL(url).search, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined };
    assert.equal(init.headers.Authorization, "Bearer relay_sk_test");
    calls.push(request);
    return Response.json(await handler(request));
  };
  const server = createRelayMcpServer("https://relay.example", "relay_sk_test", true);
  const client = new Client({ name: "slideshow-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a); await client.connect(b);
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args });
      assert.ok(!response.isError, JSON.stringify(response.content));
      return response.structuredContent;
    };
    await callback({ client, calls, call });
  } finally { globalThis.fetch = original; await client.close(); await server.close(); }
}

test("MCP saves video output and exposes asynchronous render, poll, cancel and retry", async () => {
  await session(({ path, body }) => {
    if (path === "/api/v1/slideshows") return { data: { ...body, id: "slides" } };
    if (path === "/api/v1/slideshows/render") return { format: "video", data: project, video: { projectId: "video", durationMs: 10000 }, job: { id: "job", status: "queued" } };
    return { data: { id: "job", status: body?.action === "cancel" ? "cancelled" : body?.action === "retry" ? "queued" : "completed", renderedUrl: videoUrl } };
  }, async ({ client, calls, call }) => {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.find(tool => tool.name === "save_slideshow").inputSchema.properties.output.properties.format.enum, ["images", "video"]);
    assert.ok(tools.find(tool => tool.name === "render_slideshow").inputSchema.properties.async);
    const saved = await call("save_slideshow", { name: "Launch", output: { format: "video", imageSeconds: 5 }, slides: [{ mediaUrl: urls[0], text: "Opening", deviceFrame: { device: "phone", background: "#112233", color: "#000000" } }] });
    assert.deepEqual(saved.data.output, { format: "video", imageSeconds: 5 });
    assert.equal(calls[0].body.slides[0].text, "Opening");
    assert.equal(calls[0].body.slides[0].deviceFrame.device, "phone");
    const rendered = await call("render_slideshow", { id: "slides", format: "video", imageSeconds: 5, async: true });
    assert.equal(rendered.job.id, "job");
    assert.deepEqual(calls.at(-1).body, { id: "slides", format: "video", imageSeconds: 5, async: true });
    assert.equal((await call("get_video_render_job", { id: "job" })).data.renderedUrl, videoUrl);
    assert.equal((await call("update_video_render_job", { id: "job", action: "cancel" })).data.status, "cancelled");
    assert.equal((await call("update_video_render_job", { id: "job", action: "retry" })).data.status, "queued");
    const before = calls.length;
    for (const input of [{ format: "gif" }, { format: "video", imageSeconds: 3.5 }]) {
      assert.equal((await client.callTool({ name: "render_slideshow", arguments: { id: "slides", ...input } })).isError, true);
    }
    assert.equal(calls.length, before, "invalid schema input never reaches REST");
  });
});

test("MCP slideshow scheduling sends the MP4 to Reel, TikTok and YouTube targets", async () => {
  await session(({ path }) => path === "/api/v1/slideshows/render" ? { format: "video", data: project, video: { projectId: "video", url: videoUrl, durationMs: 10000 } } : { data: { id: "post" } }, async ({ calls, call }) => {
    await call("schedule_slideshow", { projectId: "slides", format: "video", imageSeconds: 5, scheduledAt: "2027-01-01T09:00:00Z", clientRequestId: "stable", targets });
    assert.deepEqual(calls[0].body, { id: "slides", format: "video", imageSeconds: 5 });
    assert.equal(calls[1].path, "/api/v1/posts");
    assert.equal(calls[1].body.mediaType, "video"); assert.equal(calls[1].body.mediaUrl, videoUrl);
    assert.deepEqual(calls[1].body.mediaUrls, [videoUrl]);
    assert.equal(calls[1].body.clientRequestId, "stable");
    assert.deepEqual(calls[1].body.targets.map(target => target.settings.kind), ["instagram", "facebook", "tiktok", "youtube"]);
    assert.equal(calls[1].body.targets[2].settings.allowComments, true);
    assert.deepEqual(calls[1].body.targets[3].settings.tags, []);
  });
});

test("MCP preserves image output and explicit image override of saved video output", async () => {
  await session(({ path }) => path === "/api/v1/slideshows/render" ? { format: "images", data: { ...project, output: { format: "video" } } } : { data: { id: "post" } }, async ({ calls, call }) => {
    for (const format of [undefined, "images"]) {
      await call("schedule_slideshow", { projectId: "slides", format, scheduledAt: "2027-01-01T09:00:00Z", targets: [{ accountId: "instagram", settings: { kind: "instagram", publishType: "feed" } }] });
      assert.equal(calls.at(-1).body.mediaType, "image");
      assert.deepEqual(calls.at(-1).body.mediaUrls, urls);
    }
  });
});

test("MCP refuses immediate publishing without confirmation and never falls back to images after a video failure", async () => {
  await session(() => ({ format: "video", data: project, video: { projectId: "video", durationMs: 10000 } }), async ({ client, calls }) => {
    assert.equal((await client.callTool({ name: "schedule_slideshow", arguments: { projectId: "slides", format: "video", scheduledAt: null, targets } })).isError, true);
    assert.equal(calls.length, 0);
    assert.equal((await client.callTool({ name: "schedule_slideshow", arguments: { projectId: "slides", format: "video", scheduledAt: null, publishNow: true, targets } })).isError, true);
    assert.equal(calls.length, 1); assert.equal(calls[0].path, "/api/v1/slideshows/render");
    assert.equal((await client.callTool({ name: "create_slideshow_batch", arguments: { projects: [{ name: "Launch", slides: [], output: { format: "video" } }], targets } })).isError, true);
    assert.equal(calls.length, 1);
  });
});

test("MCP mixed slideshow batches use each saved output when creating posts", async () => {
  const projects = [{ name: "Photos", slides: [{ mediaUrl: urls[0] }] }, { name: "Video", slides: [{ mediaUrl: urls[0] }], output: { format: "video", imageSeconds: 8 } }];
  await session(({ path, body }) => {
    if (path === "/api/v1/slideshows") return { data: body.projects.map((project, index) => ({ index, data: { ...project, id: String(index) } })) };
    if (path === "/api/v1/slideshows/render") return body.id === "1" ? { format: "video", data: project, video: { projectId: "video", url: videoUrl, durationMs: 8000 } } : { format: "images", data: project };
    return { data: { id: "post" } };
  }, async ({ calls, call }) => {
    const result = await call("create_slideshow_batch", { projects, scheduledAt: "2027-01-01T09:00:00Z", targets: [{ accountId: "tiktok", settings: { kind: "tiktok" } }] });
    assert.equal(result.summary.failed, 0);
    assert.deepEqual(result.data.map(entry => entry.mediaType), ["image", "video"]);
    assert.deepEqual(calls.filter(call => call.path === "/api/v1/posts").map(call => call.body.mediaType), ["image", "video"]);
    assert.deepEqual(calls[0].body.projects[1].output, { format: "video", imageSeconds: 8 });
  });
});
