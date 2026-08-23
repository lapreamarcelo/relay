import assert from "node:assert/strict";
import test from "node:test";

import { nextAnalyticsDelay } from "./analytics-schedule.ts";

test("analytics polling becomes less frequent as a post ages", () => {
  assert.equal(nextAnalyticsDelay(60 * 60_000), 15 * 60_000);
  assert.equal(nextAnalyticsDelay(24 * 60 * 60_000), 60 * 60_000);
  assert.equal(nextAnalyticsDelay(4 * 24 * 60 * 60_000), 6 * 60 * 60_000);
  assert.equal(nextAnalyticsDelay(30 * 24 * 60 * 60_000), 24 * 60 * 60_000);
  assert.equal(nextAnalyticsDelay(100 * 24 * 60 * 60_000), null);
});
