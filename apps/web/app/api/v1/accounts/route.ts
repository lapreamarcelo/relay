import type { ProviderAuthMethod, ProviderId } from "@relay/core";
import { AesGcmTokenCipher } from "@relay/core/token-encryption";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";
import { getOAuthRegistry, getTokenCipherKey } from "../../../../lib/social-oauth";

interface AccountRow {
  id: string; brand_id: string | null; provider: ProviderId; auth_method: ProviderAuthMethod; provider_account_id: string;
  username: string; display_name: string; avatar_url: string | null; status: "connected" | "warning" | "expired";
  token_expires_at: string | Date | null; refresh_token_expires_at: string | Date | null; last_checked_at: string | Date | null;
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "accounts:read" });
  if (authorization.response) return authorization.response;
  const rows = await sql<AccountRow[]>`
    SELECT id, brand_id, provider, auth_method, provider_account_id, username, display_name, avatar_url, status,
      token_expires_at, refresh_token_expires_at, last_checked_at
    FROM "social_account" WHERE "owner_id" = ${authorization.session.user.id} ORDER BY "created_at" ASC
  `;
  const iso = (value: string | Date | null) => value === null ? undefined : new Date(value).toISOString();
  return Response.json({ data: rows.map((row) => ({ id: row.id, brandId: row.brand_id, provider: row.provider, authMethod: row.auth_method, providerAccountId: row.provider_account_id, handle: row.username.startsWith("@") ? row.username : `@${row.username}`, displayName: row.display_name, avatarUrl: row.avatar_url ?? undefined, status: row.status, followers: "", tokenExpiresAt: iso(row.token_expires_at), refreshTokenExpiresAt: iso(row.refresh_token_expires_at), lastCheckedAt: iso(row.last_checked_at) })) });
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown } | null; const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return Response.json({ error: "Account id is required." }, { status: 400 });
  const [account] = await sql<{ id: string; auth_method: ProviderAuthMethod; access_token_encrypted: string; refresh_token_encrypted: string | null }[]>`
    SELECT id, auth_method, access_token_encrypted, refresh_token_encrypted FROM "social_account"
    WHERE id = ${id} AND owner_id = ${authorization.session.user.id}
  `;
  if (!account) return Response.json({ error: "Account not found." }, { status: 404 });
  try {
    const adapter = getOAuthRegistry().getByAuthMethod(account.auth_method);
    if (adapter.revoke && adapter.configured) {
      const cipher = AesGcmTokenCipher.fromBase64Key(getTokenCipherKey());
      await adapter.revoke({ accessToken: cipher.decrypt(account.access_token_encrypted), refreshToken: account.refresh_token_encrypted ? cipher.decrypt(account.refresh_token_encrypted) : null });
    }
  } catch { /* Local disconnect must still succeed if a provider is unavailable or already revoked. */ }
  await sql`DELETE FROM "social_account" WHERE id = ${id} AND owner_id = ${authorization.session.user.id}`;
  return Response.json({ data: { id } });
}
