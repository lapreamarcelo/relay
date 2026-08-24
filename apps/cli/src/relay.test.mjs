import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run } from "./relay.mjs";

async function server(handler) {
  const instance = createServer(handler); await new Promise((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address(); return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve) => instance.close(resolve)) };
}

const output = () => { let value = ""; return { stream: { write: (chunk) => { value += chunk; } }, read: () => value }; };

test("resource commands send bearer-authenticated JSON", async () => {
  let request;
  const api = await server(async (incoming, response) => {
    let body = ""; for await (const chunk of incoming) body += chunk;
    request = { method: incoming.method, url: incoming.url, authorization: incoming.headers.authorization, body: JSON.parse(body) };
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ data: { id: "post-1" } }));
  });
  const printed = output();
  try {
    await run(["posts", "create", "--data", '{"text":"Hello"}'], { env: { RELAY_URL: api.url, RELAY_API_KEY: "relay_sk_test" }, stdout: printed.stream });
    assert.deepEqual(request, { method: "POST", url: "/api/v1/posts", authorization: "Bearer relay_sk_test", body: { text: "Hello" } });
    assert.equal(JSON.parse(printed.read()).data.id, "post-1");
  } finally { await api.close(); }
});

test("video schedule renders first and creates a post with the rendered artifact", async () => {
  const requests = [];
  const api = await server(async (incoming, response) => {
    let body = ""; for await (const chunk of incoming) body += chunk; requests.push({ url: incoming.url, body: JSON.parse(body) });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(incoming.url === "/api/v1/videos/render" ? { data: { brandId: "brand-1", caption: "Caption", renderedUrl: "https://media.example/video.mp4" } } : { data: { id: "post-1" } }));
  });
  const printed = output();
  try {
    await run(["videos", "schedule", "--data", JSON.stringify({ projectId: "video-1", scheduledAt: null, targets: [{ accountId: "account-1", settings: { kind: "instagram", publishType: "reel" } }] })], { env: { RELAY_URL: api.url, RELAY_API_KEY: "relay_sk_test" }, stdout: printed.stream });
    assert.equal(requests[0].url, "/api/v1/videos/render");
    assert.equal(requests[1].url, "/api/v1/posts");
    assert.equal(requests[1].body.status, "publishing");
    assert.equal(requests[1].body.mediaUrl, "https://media.example/video.mp4");
  } finally { await api.close(); }
});

test("media upload signs through Relay and streams bytes to R2", async () => {
  let api; let uploaded = ""; let prepared;
  const directory = await mkdtemp(join(tmpdir(), "relay-cli-")); const file = join(directory, "clip.mp4"); await writeFile(file, "video-bytes");
  api = await server(async (incoming, response) => {
    let body = ""; for await (const chunk of incoming) body += chunk;
    if (incoming.url === "/upload") { uploaded = body; response.statusCode = 200; response.end(); return; }
    prepared = JSON.parse(body); response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ key: "media/clip.mp4", url: "https://media.example/clip.mp4", uploadUrl: `${api.url}/upload` }));
  });
  const printed = output();
  try {
    await run(["media", "upload", "--file", file, "--project", "folder-1"], { env: { RELAY_URL: api.url, RELAY_API_KEY: "relay_sk_test" }, stdout: printed.stream });
    assert.deepEqual(prepared, { fileName: "clip.mp4", contentType: "video/mp4", projectId: "folder-1", kind: "media" });
    assert.equal(uploaded, "video-bytes");
    assert.equal(JSON.parse(printed.read()).data.key, "media/clip.mp4");
  } finally { await api.close(); await rm(directory, { recursive: true }); }
});

test("folder rename and media move use the R2 management endpoints", async () => {
  const requests = [];
  const api = await server(async (incoming, response) => {
    let body = ""; for await (const chunk of incoming) body += chunk;
    requests.push({ method: incoming.method, url: incoming.url, body: JSON.parse(body) });
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ data: { ok: true } }));
  });
  const printed = output();
  try {
    const io = { env: { RELAY_URL: api.url, RELAY_API_KEY: "relay_sk_test" }, stdout: printed.stream };
    await run(["folders", "rename", "--data", '{"id":"folder-1","name":"Launch assets"}'], io);
    await run(["media", "move", "--data", '{"key":"media/clip.mp4","projectId":"folder-1","kind":"media"}'], io);
    assert.deepEqual(requests, [
      { method: "PATCH", url: "/api/v1/media/projects", body: { id: "folder-1", name: "Launch assets" } },
      { method: "PATCH", url: "/api/v1/media", body: { key: "media/clip.mp4", projectId: "folder-1", kind: "media" } },
    ]);
  } finally { await api.close(); }
});
