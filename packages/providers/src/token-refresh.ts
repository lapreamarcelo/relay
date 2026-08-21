import type { ProviderAuthMethod } from "@relay/core";

export interface RefreshProviderTokensInput {
  refreshToken: string;
  accessToken: string;
  providerAccountId: string;
  providerMetadata: Record<string, unknown>;
  grantedScopes: string[];
}

export interface RefreshedProviderTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  refreshTokenExpiresAt?: Date | null;
  refreshAfterAt: Date;
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
  private readonly refreshers = new Map<ProviderAuthMethod, ProviderTokenRefresher>();

  register(authMethod: ProviderAuthMethod, refresher: ProviderTokenRefresher): void {
    this.refreshers.set(authMethod, refresher);
  }

  get(authMethod: ProviderAuthMethod): ProviderTokenRefresher {
    const refresher = this.refreshers.get(authMethod);
    if (!refresher) throw new Error(`No token refresher registered for ${authMethod}`);
    return refresher;
  }
}
