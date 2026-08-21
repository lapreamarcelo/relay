import assert from "node:assert/strict";
import test from "node:test";
import { OAuthProviderRegistry } from "./oauth.ts";

const environment = {
  FACEBOOK_APP_ID: "facebook-id",
  FACEBOOK_APP_SECRET: "facebook-secret",
  INSTAGRAM_APP_ID: "instagram-id",
  INSTAGRAM_APP_SECRET: "instagram-secret",
  TIKTOK_CLIENT_ID: "tiktok-id",
  TIKTOK_CLIENT_SECRET: "tiktok-secret",
  YOUTUBE_CLIENT_ID: "youtube-id",
  YOUTUBE_CLIENT_SECRET: "youtube-secret",
};

test("registers both Instagram connection methods with their exact callbacks", () => {
  const registry = new OAuthProviderRegistry(environment, "https://relay.example.com/path");
  assert.equal(registry.get("instagram").callbackUrl, "https://relay.example.com/api/oauth/instagram/callback");
  assert.equal(registry.get("instagram-standalone").callbackUrl, "https://relay.example.com/api/oauth/instagram-standalone/callback");
  assert.equal(registry.get("instagram").configured, true);
  assert.equal(registry.get("instagram-standalone").configured, true);
});

test("YouTube requests offline access and never places the client secret in the browser URL", () => {
  const adapter = new OAuthProviderRegistry(environment, "https://relay.example.com").get("youtube");
  const url = new URL(adapter.authorizationUrl("signed-state"));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "signed-state");
  assert.equal(url.toString().includes("youtube-secret"), false);
});

test("providers are disabled independently when their keys are absent", () => {
  const registry = new OAuthProviderRegistry({}, "http://localhost:3000");
  assert.equal(registry.list().every((adapter) => adapter.configured === false), true);
});

test("Instagram Login normalizes the callback code and uses a versioned profile lookup", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push({ url, init });
    if (requests.length === 1) return Response.json({ access_token: "short-token", user_id: "ig-user", permissions: ["instagram_business_basic", "instagram_business_content_publish"] });
    if (requests.length === 2) return Response.json({ access_token: "long-token", expires_in: 5_184_000 });
    return Response.json({ user_id: "ig-user", username: "relay", name: "Relay", profile_picture_url: "https://example.com/avatar.jpg" });
  }) as typeof fetch;
  try {
    const [account] = await new OAuthProviderRegistry(environment, "https://relay.example.com").get("instagram-standalone").connect("temporary-code#_");
    assert.equal(new URLSearchParams(String(requests[0].init?.body)).get("code"), "temporary-code");
    assert.equal(new URL(requests[1].url).searchParams.get("client_id"), environment.INSTAGRAM_APP_ID);
    assert.equal(new URL(requests[2].url).pathname, "/v23.0/me");
    assert.equal(account.providerAccountId, "ig-user");
    assert.deepEqual(account.grantedScopes, ["instagram_business_basic", "instagram_business_content_publish"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
