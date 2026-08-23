import assert from "node:assert/strict";
import test from "node:test";

import { createApiKeySecret, hashApiKey, readBearerToken } from "./api-keys.ts";

test("creates opaque Relay API keys and stores only a digest", () => {
  const first = createApiKeySecret();
  const second = createApiKeySecret();
  assert.match(first.secret, /^relay_sk_[A-Za-z0-9_-]+$/);
  assert.notEqual(first.secret, second.secret);
  assert.equal(first.hash, hashApiKey(first.secret));
  assert.equal(first.hash.length, 64);
  assert.ok(!first.prefix.includes(first.secret));
});

test("reads only Relay bearer tokens", () => {
  assert.equal(readBearerToken(new Request("https://relay.test", { headers: { authorization: "Bearer relay_sk_abc-123_DEF" } })), "relay_sk_abc-123_DEF");
  assert.equal(readBearerToken(new Request("https://relay.test", { headers: { authorization: "Basic abc" } })), null);
  assert.equal(readBearerToken(new Request("https://relay.test", { headers: { authorization: "Bearer something_else" } })), null);
});
