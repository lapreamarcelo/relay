import test from "node:test";
import assert from "node:assert/strict";
import type { VideoPointerEvent } from "@relay/core";
import { appendRecordingEvent, importRecordingEvents, MAX_RECORDING_EVENTS, recordingMimeType, recordingPointerEvent, uploadRecording } from "./video-recording.ts";

test("recording gestures use source milliseconds and target-relative coordinates", () => {
  const sample = recordingPointerEvent("down", 180, 250, { left: 100, top: 50, width: 400, height: 400 }, 15.5)!;
  assert.deepEqual(sample, { kind: "down", x: .2, y: .5, timeMs: 16 });
  assert.equal(recordingPointerEvent("move", 99, 250, { left: 100, top: 50, width: 400, height: 400 }, 20), undefined);
  assert.equal(recordingPointerEvent("move", 0, 0, { left: 0, top: 0, width: 0, height: 4 }, 20), undefined);
  assert.equal(recordingPointerEvent("move", NaN, 0, { left: 0, top: 0, width: 4, height: 4 }, 20), undefined);
});
test("gesture import validates malformed data, source bounds, and event limits", () => {
  const events = [{ kind: "up", x: .5, y: .5, timeMs: 120 }, { kind: "down", x: .5, y: .5, timeMs: 40 }];
  assert.deepEqual(importRecordingEvents(events, 120).events.map(event => event.timeMs), [40, 120]);
  assert.throws(() => importRecordingEvents(events, 100), /timestamps/);
  assert.throws(() => importRecordingEvents([{ ...events[0], x: 2 }]), /pointer/);
  assert.throws(() => importRecordingEvents([{ ...events[0], kind: "tap" }]), /event/);
  assert.throws(() => importRecordingEvents(Array(2001).fill(events[0])), /2000/);
  assert.throws(() => importRecordingEvents(null), /track/);
  assert.throws(() => importRecordingEvents([{ kind: "down" }]), /numeric/);
});
test("capture move throttling preserves taps and never exceeds the renderer limit", () => {
  const events: VideoPointerEvent[] = [{ kind: "move", timeMs: 0, x: 0, y: 0 }];
  appendRecordingEvent(events, { kind: "move", timeMs: 10, x: .2, y: .2 }); assert.equal(events.length, 1);
  appendRecordingEvent(events, { kind: "down", timeMs: 11, x: .2, y: .2 }); assert.equal(events.length, 2);
  while (events.length < MAX_RECORDING_EVENTS) events.push({ kind: "down", timeMs: 100, x: .2, y: .2 });
  appendRecordingEvent(events, { kind: "up", timeMs: 200, x: .2, y: .2 });
  assert.equal(events.length, MAX_RECORDING_EVENTS); assert.equal(events.at(-1)?.kind, "up");
});
test("recording codec negotiation selects only a browser-supported container", () => {
  assert.equal(recordingMimeType(mime => mime === "video/webm;codecs=vp8"), "video/webm;codecs=vp8");
  assert.equal(recordingMimeType(() => false), undefined);
});
test("recording uploads reuse media authorization and fall back when direct PUT is blocked", async () => {
  const calls: { url: string; method?: string; body?: BodyInit | null }[] = [];
  const fakeFetch = async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), method: options?.method, body: options?.body });
    if (calls.length === 1) return Response.json({ key: "media/direct", url: "https://media.test/direct", uploadUrl: "https://signed.test/direct" });
    if (calls.length === 2) throw new TypeError("CORS");
    return Response.json({ key: "media/fallback", url: "https://media.test/fallback" });
  };
  const result = await uploadRecording(new File(["video"], "capture.webm", { type: "video/webm" }), fakeFetch as typeof fetch);
  assert.equal(result.key, "media/fallback"); assert.equal(calls[1].method, "PUT");
  assert.ok(calls[2].body instanceof FormData); assert.equal((calls[2].body as FormData).get("kind"), "media");
  await assert.rejects(uploadRecording(new File([""], "empty.mp4", { type: "video/mp4" }), fakeFetch as typeof fetch), /100 MB/);
});
test("authorization failures stop before an upload and never fall back to bypass auth", async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return Response.json({ error: "Not authorized" }, { status: 401 }); };
  await assert.rejects(uploadRecording(new File(["x"], "capture.mp4", { type: "video/mp4" }), fakeFetch), /Not authorized/);
  assert.equal(calls, 1);
});
