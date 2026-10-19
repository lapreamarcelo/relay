import test from "node:test";
import assert from "node:assert/strict";
import { uploadVideoAudio } from "./video-audio-upload.ts";

const file = () => new File(["song"], "song.mp3", { type: "audio/mpeg" });
const signed = { key: "music/direct.mp3", url: "https://media.test/direct.mp3", uploadUrl: "https://storage.test/signed" };
const largeFile = () => Object.defineProperty(file(), "size", { value: 100 * 1024 * 1024 + 1 });

test("normal song uploads make one same-origin request and preserve folder and returned asset", async () => {
  for (const folder of ["folder-1", "unfiled", "all", undefined]) {
    let calls = 0;
    const result = await uploadVideoAudio(file(), folder, async (url, options) => {
      calls++; assert.equal(url, "/api/v1/media"); assert.equal(options?.method, "POST"); assert.equal(options?.headers, undefined);
      const form = options?.body as FormData;
      assert.equal(form.get("kind"), "music"); assert.equal(form.get("projectId"), folder && folder !== "all" ? folder : null);
      assert.equal((form.get("file") as File).name, "song.mp3");
      return Response.json({ key: "music/server.mp3", url: "https://media.test/server.mp3" }, { status: 201 });
    });
    assert.equal(calls, 1); assert.deepEqual(result, { key: "music/server.mp3", url: "https://media.test/server.mp3", name: "song.mp3" });
  }
});

test("same-origin authorization and storage errors stop and reach the editor", async () => {
  for (const [status, error] of [[401, "Not authorized"], [503, "Storage unavailable"]] as const) {
    let calls = 0;
    await assert.rejects(uploadVideoAudio(file(), undefined, async () => { calls++; return Response.json({ error }, { status }); }), { message: error });
    assert.equal(calls, 1);
  }
});

test("large audio files retain signed direct uploads and the selected folder", async () => {
  let calls = 0;
  const result = await uploadVideoAudio(largeFile(), "folder-1", async (url, options) => {
    if (++calls === 1) {
      assert.deepEqual(JSON.parse(String(options?.body)), { fileName: "song.mp3", contentType: "audio/mpeg", kind: "music", projectId: "folder-1" });
      return Response.json(signed);
    }
    assert.equal(url, signed.uploadUrl); assert.equal(options?.method, "PUT");
    return new Response(null, { status: 200 });
  });
  assert.equal(calls, 2); assert.deepEqual(result, { key: signed.key, url: signed.url, name: "song.mp3" });
});

test("blocked large uploads explain the size limit and never attempt oversized multipart", async () => {
  for (const networkError of [true, false]) {
    let calls = 0;
    await assert.rejects(uploadVideoAudio(largeFile(), undefined, async () => {
      calls++;
      if (calls === 1) return Response.json(signed);
      if (networkError) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 403 });
    }), /up to 100 MB/);
    assert.equal(calls, 2);
  }
  let calls = 0;
  await assert.rejects(uploadVideoAudio(largeFile(), undefined, async () => { calls++; return Response.json({ error: "Not authorized" }, { status: 401 }); }), /Not authorized/);
  assert.equal(calls, 1);
});
