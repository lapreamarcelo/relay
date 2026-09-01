import assert from "node:assert/strict";
import test from "node:test";

import { collectFilteredPage } from "./filtered-pagination.ts";

test("skips an unrelated R2 page instead of returning an empty filtered page", async () => {
  const pages = new Map<string | null, { items: string[]; nextToken: string | null }>([
    [null, { items: ["image-1", "image-2", "manifest"], nextToken: "music-page" }],
    ["music-page", { items: ["track-1", "track-2"], nextToken: null }],
  ]);
  const result = await collectFilteredPage({ cursor: null, limit: 2, list: async (token) => pages.get(token)!, include: (item) => item.startsWith("track-") });
  assert.deepEqual(result, { items: ["track-1", "track-2"], nextCursor: null });
});

test("resumes inside a scanned R2 page without dropping matching assets", async () => {
  const source = { items: ["track-1", "track-2", "track-3", "track-4", "track-5"], nextToken: null };
  const first = await collectFilteredPage({ cursor: null, limit: 2, list: async () => source, include: () => true });
  const second = await collectFilteredPage({ cursor: first.nextCursor, limit: 2, list: async () => source, include: () => true });
  const third = await collectFilteredPage({ cursor: second.nextCursor, limit: 2, list: async () => source, include: () => true });
  assert.deepEqual([...first.items, ...second.items, ...third.items], source.items);
  assert.equal(third.nextCursor, null);
});
