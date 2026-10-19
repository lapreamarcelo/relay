import test from "node:test";
import assert from "node:assert/strict";
import { uploadVideoAudio } from "./video-audio-upload.ts";

const file = () => new File(["song"], "song.mp3", { type: "audio/mpeg" });
const signed = { key: "music/direct.mp3", url: "https://media.test/direct.mp3", uploadUrl: "https://storage.test/signed" };

test("direct song uploads preserve the audio folder and canonical asset URL", async () => {
  let calls = 0;
  const result = await uploadVideoAudio(file(), "folder-1", async (url, options) => {
    if (++calls === 1) {
      assert.deepEqual(JSON.parse(String(options?.body)), { fileName: "song.mp3", contentType: "audio/mpeg", kind: "music", projectId: "folder-1" });
      return Response.json(signed);
    }
    assert.equal(url, signed.uploadUrl); assert.equal(options?.method, "PUT");
    return new Response(null, { status: 200 });
  });
  assert.equal(calls, 2); assert.deepEqual(result, { key: signed.key, url: signed.url, name: "song.mp3" });
});

test("blocked and rejected direct uploads use the fallback object and preserve the folder", async () => {
  for (const failsWithNetworkError of [true, false]) {
    let calls = 0;
    const result = await uploadVideoAudio(file(), "unfiled", async (url, options) => {
      calls++;
      if (calls === 1) return Response.json(signed);
      if (calls === 2) { if (failsWithNetworkError) throw new TypeError("Failed to fetch"); return new Response(null, { status: 403 }); }
      assert.equal(url, "/api/v1/media"); assert.equal(options?.method, "POST");
      assert.equal(options?.headers, undefined);
      const form = options?.body as FormData;
      assert.equal(form.get("kind"), "music"); assert.equal(form.get("projectId"), "unfiled"); assert.equal((form.get("file") as File).name, "song.mp3");
      return Response.json({ key: "music/fallback.mp3", url: "https://media.test/fallback.mp3" }, { status: 201 });
    });
    assert.equal(calls, 3); assert.equal(result.url, "https://media.test/fallback.mp3"); assert.equal(result.key, "music/fallback.mp3");
  }
});

test("authorization failures never trigger fallback and server errors reach the editor", async () => {
  let calls = 0;
  await assert.rejects(uploadVideoAudio(file(), undefined, async () => { calls++; return Response.json({ error: "Not authorized" }, { status: 401 }); }), /Not authorized/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(uploadVideoAudio(file(), "all", async (_url, options) => {
    calls++;
    if (calls === 1) { assert.equal(JSON.parse(String(options?.body)).projectId, undefined); return Response.json(signed); }
    if (calls === 2) throw new TypeError("Failed to fetch");
    assert.equal((options?.body as FormData).has("projectId"), false);
    return Response.json({ error: "Storage unavailable" }, { status: 503 });
  }), /Storage unavailable/);
});
