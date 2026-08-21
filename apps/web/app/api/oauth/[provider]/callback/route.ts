import { AesGcmTokenCipher } from "@relay/core/token-encryption";
import { sql } from "@relay/database";
import { ProviderOAuthError } from "@relay/providers/oauth";
import { NextResponse } from "next/server";

import { requireApiSession } from "../../../../../lib/api-session";
import { oauthCookieOptions, OAUTH_STATE_COOKIE, verifyOAuthState } from "../../../../../lib/oauth-state";
import { getOAuthRegistry, getTokenCipherKey } from "../../../../../lib/social-oauth";

function appRedirect(parameters: Record<string, string>): NextResponse {
  const url = new URL(process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_STATE_COOKIE, "", { ...oauthCookieOptions(), maxAge: 0 });
  return response;
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? request.url));
  const { provider } = await context.params; const query = new URL(request.url).searchParams;
  const state = query.get("state") ?? "";
  if (!state) return appRedirect({ oauth: "error", code: "invalid_callback" });

  try {
    const registry = getOAuthRegistry(); const adapter = registry.get(provider);
    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookieState = cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${OAUTH_STATE_COOKIE}=`))?.slice(OAUTH_STATE_COOKIE.length + 1);
    const oauthState = verifyOAuthState(state, cookieState ? decodeURIComponent(cookieState) : undefined, adapter.flow, authorization.session.user.id);
    if (query.has("error")) return appRedirect({ oauth: "error", code: "authorization_denied" });
    const code = query.get("code") ?? "";
    if (!code) return appRedirect({ oauth: "error", code: "invalid_callback" });
    const [brand] = await sql<{ id: string }[]>`SELECT id FROM "brand" WHERE "id" = ${oauthState.brandId} AND "owner_id" = ${authorization.session.user.id}`;
    if (!brand) return appRedirect({ oauth: "error", code: "brand_not_found" });
    const cipher = AesGcmTokenCipher.fromBase64Key(getTokenCipherKey());
    const connected = await adapter.connect(code);
    for (const account of connected) {
      const id = crypto.randomUUID();
      const encryptedAccess = cipher.encrypt(account.accessToken);
      const encryptedRefresh = account.refreshToken ? cipher.encrypt(account.refreshToken) : null;
      await sql`
        INSERT INTO "social_account" (
          id, owner_id, brand_id, provider, auth_method, provider_account_id, username, display_name, avatar_url,
          access_token_encrypted, refresh_token_encrypted, token_expires_at, refresh_token_expires_at, refresh_after_at,
          granted_scopes, provider_metadata, status, last_checked_at
        ) VALUES (
          ${id}, ${authorization.session.user.id}, ${brand.id}, ${account.provider}, ${account.authMethod}, ${account.providerAccountId},
          ${account.username}, ${account.displayName}, ${account.avatarUrl}, ${encryptedAccess}, ${encryptedRefresh},
          ${account.tokenExpiresAt?.toISOString() ?? null}, ${account.refreshTokenExpiresAt?.toISOString() ?? null}, ${account.refreshAfterAt?.toISOString() ?? null},
          ${sql.json(account.grantedScopes)}, ${sql.json(account.providerMetadata as Parameters<typeof sql.json>[0])}, 'connected', NOW()
        )
        ON CONFLICT (owner_id, provider, provider_account_id) DO UPDATE SET
          brand_id = EXCLUDED.brand_id, auth_method = EXCLUDED.auth_method, username = EXCLUDED.username,
          display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url,
          access_token_encrypted = EXCLUDED.access_token_encrypted, refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
          token_expires_at = EXCLUDED.token_expires_at, refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
          refresh_after_at = EXCLUDED.refresh_after_at, granted_scopes = EXCLUDED.granted_scopes,
          provider_metadata = EXCLUDED.provider_metadata, status = 'connected', last_checked_at = NOW(), updated_at = NOW(),
          refresh_lease_owner = NULL, refresh_lease_expires_at = NULL
      `;
    }
    return appRedirect({ oauth: "success", provider: adapter.provider, count: String(connected.length) });
  } catch (error) {
    const codeValue = error instanceof ProviderOAuthError && error.reconnectRequired ? "authorization_expired" : error instanceof ProviderOAuthError ? "provider_rejected" : "callback_failed";
    console.error(JSON.stringify({ level: "error", event: "oauth_callback_failed", provider, code: codeValue }));
    return appRedirect({ oauth: "error", code: codeValue });
  }
}
