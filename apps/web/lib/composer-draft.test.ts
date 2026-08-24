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
