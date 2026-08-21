import type { AccountCredential, AccountCredentialRepository } from "@relay/core/account-credentials";
import type { TokenCipher } from "@relay/core/token-encryption";
import { ProviderAuthorizationError, type ProviderRefreshRegistry } from "@relay/providers/token-refresh";

const MINUTE = 60_000;

export class AccountReconnectRequiredError extends Error {
  constructor(readonly accountId: string) {
    super(`Account ${accountId} must be reconnected`);
    this.name = "AccountReconnectRequiredError";
  }
}

export class TokenRefreshInProgressError extends Error {
  constructor(readonly accountId: string) {
    super(`Token refresh already in progress for account ${accountId}`);
    this.name = "TokenRefreshInProgressError";
  }
}

export interface TokenLifecycleOptions {
  refreshWindowMs?: number;
  refreshLeaseMs?: number;
  sweepBatchSize?: number;
  workerId?: string;
}

export interface TokenSweepResult {
  examined: number;
  refreshed: number;
  reconnectRequired: number;
  deferred: number;
}

export class TokenLifecycleService {
  private readonly refreshWindowMs: number;
  private readonly refreshLeaseMs: number;
  private readonly sweepBatchSize: number;
  private readonly workerId: string;

  constructor(
    private readonly repository: AccountCredentialRepository,
    private readonly cipher: TokenCipher,
    private readonly providers: ProviderRefreshRegistry,
    options: TokenLifecycleOptions = {},
  ) {
    this.refreshWindowMs = options.refreshWindowMs ?? 15 * MINUTE;
    this.refreshLeaseMs = options.refreshLeaseMs ?? 2 * MINUTE;
    this.sweepBatchSize = options.sweepBatchSize ?? 50;
    this.workerId = options.workerId ?? `worker-${crypto.randomUUID()}`;
  }

  async getValidAccessToken(accountId: string, now = new Date()): Promise<string> {
    const account = await this.requireAccount(accountId);
    if (account.status === "expired") throw new AccountReconnectRequiredError(accountId);

    if (!this.needsRefresh(account, now)) return this.cipher.decrypt(account.accessTokenEncrypted);
    return this.refreshAccount(accountId, now);
  }

  async sweep(now = new Date()): Promise<TokenSweepResult> {
    const refreshBefore = new Date(now.getTime() + this.refreshWindowMs);
    const candidates = await this.repository.findRefreshCandidates(refreshBefore, this.sweepBatchSize);
    const result: TokenSweepResult = { examined: candidates.length, refreshed: 0, reconnectRequired: 0, deferred: 0 };

    await Promise.all(candidates.map(async (candidate) => {
      try {
        await this.refreshAccount(candidate.accountId, now);
        result.refreshed += 1;
      } catch (error) {
        if (error instanceof AccountReconnectRequiredError) result.reconnectRequired += 1;
        else result.deferred += 1;
      }
    }));

    return result;
  }

  private needsRefresh(account: AccountCredential, now: Date): boolean {
    if (!account.tokenExpiresAt) return false;
    return account.tokenExpiresAt.getTime() <= now.getTime() + this.refreshWindowMs;
  }

  private async refreshAccount(accountId: string, now: Date): Promise<string> {
    const leaseOwner = `${this.workerId}:${crypto.randomUUID()}`;
    const claimed = await this.repository.claimRefresh(accountId, leaseOwner, new Date(now.getTime() + this.refreshLeaseMs));
    if (!claimed) throw new TokenRefreshInProgressError(accountId);

    if (!claimed.refreshTokenEncrypted || (claimed.refreshTokenExpiresAt && claimed.refreshTokenExpiresAt <= now)) {
      await this.repository.markExpired(accountId, leaseOwner, now);
      throw new AccountReconnectRequiredError(accountId);
    }

    const existingRefreshToken = this.cipher.decrypt(claimed.refreshTokenEncrypted);

    try {
      const refreshed = await this.providers.get(claimed.provider)({
        refreshToken: existingRefreshToken,
        grantedScopes: claimed.grantedScopes,
      });
      if (refreshed.expiresAt <= now) throw new Error("Provider returned an already-expired access token");

      const nextRefreshToken = refreshed.refreshToken ?? existingRefreshToken;
      await this.repository.saveRefreshed(accountId, leaseOwner, {
        accessTokenEncrypted: this.cipher.encrypt(refreshed.accessToken),
        refreshTokenEncrypted: this.cipher.encrypt(nextRefreshToken),
        tokenExpiresAt: refreshed.expiresAt,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? claimed.refreshTokenExpiresAt,
        grantedScopes: refreshed.grantedScopes ?? claimed.grantedScopes,
      }, now);
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof ProviderAuthorizationError && error.reconnectRequired) {
        await this.repository.markExpired(accountId, leaseOwner, now);
        throw new AccountReconnectRequiredError(accountId);
      }
      await this.repository.markRefreshWarning(accountId, leaseOwner, now);
      throw error;
    }
  }

  private async requireAccount(accountId: string): Promise<AccountCredential> {
    const account = await this.repository.findByAccountId(accountId);
    if (!account) throw new Error(`Account ${accountId} does not exist`);
    return account;
  }
}
