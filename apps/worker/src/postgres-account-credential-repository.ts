import type { AccountCredential, AccountCredentialRepository, RotatedAccountTokens } from "@relay/core/account-credentials";
import type { AccountStatus, ProviderAuthMethod, ProviderId } from "@relay/core";
import { sql } from "@relay/database";

interface CredentialRow {
  id: string; provider: ProviderId; auth_method: ProviderAuthMethod; provider_account_id: string;
  access_token_encrypted: string; refresh_token_encrypted: string | null; token_expires_at: string | Date | null;
  refresh_token_expires_at: string | Date | null; refresh_after_at: string | Date | null; granted_scopes: string[];
  provider_metadata: Record<string, unknown>; status: AccountStatus; last_checked_at: string | Date | null;
  refresh_lease_owner: string | null; refresh_lease_expires_at: string | Date | null;
}

function date(value: string | Date | null): Date | null {
  return value === null ? null : value instanceof Date ? value : new Date(value);
}

function credential(row: CredentialRow): AccountCredential {
  return { accountId: row.id, provider: row.provider, authMethod: row.auth_method, providerAccountId: row.provider_account_id, providerMetadata: row.provider_metadata, accessTokenEncrypted: row.access_token_encrypted, refreshTokenEncrypted: row.refresh_token_encrypted, tokenExpiresAt: date(row.token_expires_at), refreshTokenExpiresAt: date(row.refresh_token_expires_at), refreshAfterAt: date(row.refresh_after_at), grantedScopes: row.granted_scopes, status: row.status, lastCheckedAt: date(row.last_checked_at), refreshLeaseOwner: row.refresh_lease_owner, refreshLeaseExpiresAt: date(row.refresh_lease_expires_at) };
}

export class PostgresAccountCredentialRepository implements AccountCredentialRepository {
  async findByAccountId(accountId: string): Promise<AccountCredential | null> {
    const [row] = await sql<CredentialRow[]>`
      SELECT id, provider, auth_method, provider_account_id, access_token_encrypted, refresh_token_encrypted,
        token_expires_at, refresh_token_expires_at, refresh_after_at, granted_scopes, provider_metadata, status,
        last_checked_at, refresh_lease_owner, refresh_lease_expires_at
      FROM "social_account" WHERE id = ${accountId}
    `;
    return row ? credential(row) : null;
  }

  async findRefreshCandidates(refreshBefore: Date, limit: number): Promise<AccountCredential[]> {
    const rows = await sql<CredentialRow[]>`
      SELECT id, provider, auth_method, provider_account_id, access_token_encrypted, refresh_token_encrypted,
        token_expires_at, refresh_token_expires_at, refresh_after_at, granted_scopes, provider_metadata, status,
        last_checked_at, refresh_lease_owner, refresh_lease_expires_at
      FROM "social_account"
      WHERE status <> 'expired' AND refresh_after_at IS NOT NULL AND refresh_after_at <= ${refreshBefore.toISOString()}
        AND (refresh_lease_expires_at IS NULL OR refresh_lease_expires_at <= NOW())
      ORDER BY refresh_after_at ASC LIMIT ${limit}
    `;
    return rows.map(credential);
  }

  async claimRefresh(accountId: string, leaseOwner: string, leaseExpiresAt: Date): Promise<AccountCredential | null> {
    const [row] = await sql<CredentialRow[]>`
      UPDATE "social_account" SET refresh_lease_owner = ${leaseOwner}, refresh_lease_expires_at = ${leaseExpiresAt.toISOString()}, updated_at = NOW()
      WHERE id = ${accountId} AND status <> 'expired' AND (refresh_lease_expires_at IS NULL OR refresh_lease_expires_at <= NOW())
      RETURNING id, provider, auth_method, provider_account_id, access_token_encrypted, refresh_token_encrypted,
        token_expires_at, refresh_token_expires_at, refresh_after_at, granted_scopes, provider_metadata, status,
        last_checked_at, refresh_lease_owner, refresh_lease_expires_at
    `;
    return row ? credential(row) : null;
  }

  async saveRefreshed(accountId: string, leaseOwner: string, tokens: RotatedAccountTokens, checkedAt: Date): Promise<void> {
    await sql`
      UPDATE "social_account" SET access_token_encrypted = ${tokens.accessTokenEncrypted}, refresh_token_encrypted = ${tokens.refreshTokenEncrypted},
        token_expires_at = ${tokens.tokenExpiresAt?.toISOString() ?? null}, refresh_token_expires_at = ${tokens.refreshTokenExpiresAt?.toISOString() ?? null},
        refresh_after_at = ${tokens.refreshAfterAt?.toISOString() ?? null}, granted_scopes = ${sql.json(tokens.grantedScopes)}, status = 'connected',
        last_checked_at = ${checkedAt.toISOString()}, refresh_lease_owner = NULL, refresh_lease_expires_at = NULL, updated_at = NOW()
      WHERE id = ${accountId} AND refresh_lease_owner = ${leaseOwner}
    `;
  }

  async markRefreshWarning(accountId: string, leaseOwner: string, checkedAt: Date): Promise<void> {
    await sql`UPDATE "social_account" SET status = 'warning', last_checked_at = ${checkedAt.toISOString()}, refresh_lease_owner = NULL, refresh_lease_expires_at = NULL, updated_at = NOW() WHERE id = ${accountId} AND refresh_lease_owner = ${leaseOwner}`;
  }

  async markExpired(accountId: string, leaseOwner: string, checkedAt: Date): Promise<void> {
    await sql`UPDATE "social_account" SET status = 'expired', last_checked_at = ${checkedAt.toISOString()}, refresh_lease_owner = NULL, refresh_lease_expires_at = NULL, updated_at = NOW() WHERE id = ${accountId} AND refresh_lease_owner = ${leaseOwner}`;
  }
}
