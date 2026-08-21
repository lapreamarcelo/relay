import type { ProviderAuthMethod } from "@relay/core";
import { OAuthProviderRegistry, ProviderOAuthError, type OAuthEnvironment } from "./oauth";
import { ProviderAuthorizationError, ProviderRefreshRegistry } from "./token-refresh";

export function createProviderRefreshRegistry(env: OAuthEnvironment, appUrl: string): ProviderRefreshRegistry {
  const oauth = new OAuthProviderRegistry(env, appUrl);
  const registry = new ProviderRefreshRegistry();
  const methods: ProviderAuthMethod[] = ["facebook", "instagram-facebook", "instagram-standalone", "tiktok", "youtube"];
  for (const method of methods) {
    const adapter = oauth.getByAuthMethod(method);
    registry.register(method, async (input) => {
      try {
        return await adapter.refresh(input);
      } catch (error) {
        if (error instanceof ProviderOAuthError) throw new ProviderAuthorizationError(error.message, error.reconnectRequired);
        throw error;
      }
    });
  }
  return registry;
}
