import type { ProviderId } from "@relay/core";

export interface RefreshProviderTokensInput {
  refreshToken: string;
  grantedScopes: string[];
}

export interface RefreshedProviderTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  refreshTokenExpiresAt?: Date | null;
  grantedScopes?: string[];
}

export type ProviderTokenRefresher = (input: RefreshProviderTokensInput) => Promise<RefreshedProviderTokens>;

export class ProviderAuthorizationError extends Error {
  constructor(message: string, readonly reconnectRequired: boolean) {
    super(message);
    this.name = "ProviderAuthorizationError";
  }
}

export class ProviderRefreshRegistry {
  private readonly refreshers = new Map<ProviderId, ProviderTokenRefresher>();

  register(provider: ProviderId, refresher: ProviderTokenRefresher): void {
    this.refreshers.set(provider, refresher);
  }

  get(provider: ProviderId): ProviderTokenRefresher {
    const refresher = this.refreshers.get(provider);
    if (!refresher) throw new Error(`No token refresher registered for ${provider}`);
    return refresher;
  }
}
