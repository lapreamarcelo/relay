import type { TokenLifecycleService } from "./token-lifecycle.ts";
import { ProviderPublishError } from "@relay/providers/publish";

/**
 * Publishing must always go through this guard. The background sweep reduces
 * latency, while this just-in-time check guarantees an expiring token is never
 * handed to a provider publish call.
 */
export async function withFreshAccountToken<T>(
  lifecycle: TokenLifecycleService,
  accountId: string,
  publish: (accessToken: string) => Promise<T>,
): Promise<T> {
  const accessToken = await lifecycle.getValidAccessToken(accountId);
  try {
    return await publish(accessToken);
  } catch (error) {
    if (error instanceof ProviderPublishError && error.reconnectRequired) {
      await lifecycle.markAuthorizationRejected(accountId, accessToken, error.message);
    }
    throw error;
  }
}
