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
