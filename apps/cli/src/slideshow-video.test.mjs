import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./relay.mjs";

test("CLI slideshow schedule uses saved video output or an explicit render format", async () => {
  for (const format of [undefined, "video", "images"]) {
    const calls = [];
    const imageUrl = "https://media.example/first.jpg", videoUrl = "https://media.example/slideshow.mp4";
    const output = format === "images" ? "images" : "video";
    const io = { env: { RELAY_URL: "https://relay.example", RELAY_API_KEY: "relay_sk_test" }, stdout: { write() {} }, fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ path: new URL(url).pathname, body });
      return Response.json(new URL(url).pathname.endsWith("/render") ? { format: output, data: { caption: "Launch", brandId: "brand", output: { format: "video" }, slides: [{ renderedUrl: imageUrl }] }, ...(output === "video" ? { video: { url: videoUrl } } : {}) } : { data: { id: "post" } });
    } };
    await run(["slideshows", "schedule", "--data", JSON.stringify({ projectId: "slideshow", format, imageSeconds: 5, scheduledAt: "2027-01-01T09:00:00Z", targets: [{ accountId: "account", settings: { kind: "tiktok" } }] })], io);
    assert.deepEqual(calls[0].body, { id: "slideshow", ...(format ? { format } : {}), imageSeconds: 5 });
    assert.equal(calls[1].body.mediaType, output === "images" ? "image" : "video");
    assert.equal(calls[1].body.mediaUrl, output === "images" ? imageUrl : videoUrl);
    assert.deepEqual(calls[1].body.mediaUrls, [output === "images" ? imageUrl : videoUrl]);
  }
});

test("CLI does not create an image post when video rendering returns no artifact", async () => {
  const calls = [];
  const io = { env: { RELAY_URL: "https://relay.example", RELAY_API_KEY: "relay_sk_test" }, stdout: { write() {} }, fetchImpl: async (url) => {
    calls.push(url);
    return Response.json({ format: "video", data: { slides: [{ renderedUrl: "https://media.example/first.jpg" }] } });
  } };
  await assert.rejects(() => run(["slideshows", "schedule", "--data", JSON.stringify({ projectId: "slideshow", format: "video", scheduledAt: "2027-01-01T09:00:00Z", targets: [{ accountId: "account" }] })], io), /no complete video/);
  assert.equal(calls.length, 1);
});
