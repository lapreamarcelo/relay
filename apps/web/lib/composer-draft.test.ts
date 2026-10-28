import assert from "node:assert/strict";
import test from "node:test";
import { parseComposerDraft } from "./composer-draft.ts";

test("recovers a valid versioned composer draft", () => {
  const draft = parseComposerDraft(JSON.stringify({ version: 1, text: "Recovered", brandId: "brand", campaignId: "", selected: ["account"], variants: {}, schedule: true, scheduledAt: "2027-01-01T09:00", updatedAt: "2026-01-01T00:00:00.000Z" }));
  assert.equal(draft?.text, "Recovered"); assert.deepEqual(draft?.selected, ["account"]);
});

test("ignores corrupt and unknown draft formats", () => {
  assert.equal(parseComposerDraft("{"), null); assert.equal(parseComposerDraft(JSON.stringify({ version: 2 })), null);
});

test("retains YouTube image timing and metadata with the original ordered images", () => {
  const youtube = { kind: "youtube", title: "A launch", tags: ["launch"], privacyStatus: "unlisted", madeForKids: false, imageSeconds: 5 };
  const urls = ["https://media.example/one.jpg", "https://media.example/two.jpg"];
  const draft = parseComposerDraft(JSON.stringify({ version: 1, text: "Launch", brandId: "brand", selected: ["youtube"], scheduledAt: "2027-01-01T09:00", youtube, media: { name: "Slides", url: urls[0], previewUrl: urls[0], type: "image", urls } }));
  assert.deepEqual(draft?.youtube, { ...youtube, thumbnailUrl: undefined });
  assert.equal(draft?.media?.type, "image");
  assert.deepEqual(draft?.media?.urls, urls);
});

test("ignores invalid stored timing without losing the rest of the YouTube draft", () => {
  for (const imageSeconds of [2, 11, 3.5, "5", null]) {
    const draft = parseComposerDraft(JSON.stringify({ version: 1, text: "Launch", brandId: "brand", selected: [], scheduledAt: "2027-01-01T09:00", youtube: { kind: "youtube", title: "Keep title", imageSeconds } }));
    assert.equal(draft?.youtube?.imageSeconds, undefined);
    assert.equal(draft?.youtube?.title, "Keep title");
  }
});
