import assert from "node:assert/strict";
import test from "node:test";

import { alternateByType, scheduleSeries } from "./schedule-series.ts";

test("scheduleSeries creates consecutive local calendar dates", () => {
  const result = scheduleSeries("2026-09-01T09:30", 3, 1).map((value) => new Date(value));
  assert.deepEqual(result.map((date) => date.getDate()), [1, 2, 3]);
  assert.deepEqual(result.map((date) => [date.getHours(), date.getMinutes()]), [[9, 30], [9, 30], [9, 30]]);
});

test("scheduleSeries supports every x days and clamps invalid intervals", () => {
  assert.deepEqual(scheduleSeries("2026-09-01T09:30", 3, 2).map((value) => new Date(value).getDate()), [1, 3, 5]);
  assert.deepEqual(scheduleSeries("2026-09-01T09:30", 2, 0).map((value) => new Date(value).getDate()), [1, 2]);
});

test("alternateByType preserves order within each media type", () => {
  const items = [{ id: "v1", type: "video" as const }, { id: "v2", type: "video" as const }, { id: "i1", type: "image" as const }, { id: "i2", type: "image" as const }, { id: "i3", type: "image" as const }];
  assert.deepEqual(alternateByType(items, (item) => item.type).map((item) => item.id), ["v1", "i1", "v2", "i2", "i3"]);
});
