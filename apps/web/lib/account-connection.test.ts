import assert from "node:assert/strict";
import test from "node:test";
import type { SocialAccount } from "@relay/core";
import { accountConnectionMessage, accountReconnectUrl } from "./account-connection.ts";

test("reconnecting keeps the login method and brand", () => {
  assert.equal(accountReconnectUrl({ authMethod: "instagram-facebook", brandId: "brand /1" }), "/api/oauth/instagram/start?brandId=brand%20%2F1");
  for (const authMethod of ["instagram-standalone", "facebook", "tiktok", "youtube"] as const) {
    assert.equal(accountReconnectUrl({ authMethod, brandId: null }), `/api/oauth/${authMethod}/start`);
  }
});

test("account health explains invalidated sessions and hides resolved failures", () => {
  const account = { status: "expired", connectionError: "Error validating access token: The session has been invalidated because the user changed their password. TikTok code: 190." } as SocialAccount;
  assert.match(accountConnectionMessage(account)!, /Meta invalidated.*password change.*Reconnect/);
  assert.equal(accountConnectionMessage({ ...account, status: "connected" }), undefined);
  assert.match(accountConnectionMessage({ ...account, connectionError: undefined })!, /expired or was revoked/);
  assert.match(accountConnectionMessage({ ...account, status: "warning", connectionError: undefined })!, /try again automatically/);
});
