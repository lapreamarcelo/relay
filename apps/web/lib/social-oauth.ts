import "server-only";

import { OAuthProviderRegistry, type OAuthEnvironment } from "@relay/providers/oauth";

export function getOAuthRegistry(): OAuthProviderRegistry {
  const appUrl = process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return new OAuthProviderRegistry(process.env as OAuthEnvironment, appUrl);
}

export function getTokenCipherKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY is required to connect social accounts");
  return key;
}
