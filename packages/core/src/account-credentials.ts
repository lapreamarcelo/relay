import type { AccountStatus, ProviderId } from "./index";

export interface AccountCredential {
  accountId: string;
  provider: ProviderId;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  grantedScopes: string[];
  status: AccountStatus;
  lastCheckedAt: Date | null;
  refreshLeaseOwner: string | null;
  refreshLeaseExpiresAt: Date | null;
}

export interface RotatedAccountTokens {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  grantedScopes: string[];
}

export interface AccountCredentialRepository {
  findByAccountId(accountId: string): Promise<AccountCredential | null>;
  findRefreshCandidates(refreshBefore: Date, limit: number): Promise<AccountCredential[]>;
  claimRefresh(accountId: string, leaseOwner: string, leaseExpiresAt: Date): Promise<AccountCredential | null>;
  saveRefreshed(accountId: string, leaseOwner: string, tokens: RotatedAccountTokens, checkedAt: Date): Promise<void>;
  markRefreshWarning(accountId: string, leaseOwner: string, checkedAt: Date): Promise<void>;
  markExpired(accountId: string, leaseOwner: string, checkedAt: Date): Promise<void>;
}
