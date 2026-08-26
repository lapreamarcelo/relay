import assert from "node:assert/strict";
import test from "node:test";
import { parseRelayView, relayViewUrl } from "./app-navigation.ts";

test("parses supported views and rejects unknown values", () => {
  assert.equal(parseRelayView("calendar"), "calendar");
  assert.equal(parseRelayView("docs"), "docs");
  assert.equal(parseRelayView("anything"), "home");
  assert.equal(parseRelayView(null), "home");
});

test("view URLs preserve unrelated state", () => {
  assert.equal(relayViewUrl("posts", new URL("https://relay.test/?oauth=success#today")), "/?oauth=success&view=posts#today");
  assert.equal(relayViewUrl("home", new URL("https://relay.test/?view=calendar&brand=one")), "/?brand=one");
  assert.equal(relayViewUrl("docs", new URL("https://relay.test/")), "/?view=docs");
});
