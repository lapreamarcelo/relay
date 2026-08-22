import type { ProviderAuthMethod, ProviderId, SocialAccount } from "@relay/core";
import { sql } from "@relay/database";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "../lib/auth";
import RelayApp from "./relay-app";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect("/login");

  const brandRows = await sql<{ id: string; name: string; monogram: string; color: string; timezone: string }[]>`
    SELECT id, name, monogram, color, timezone FROM "brand" WHERE "owner_id" = ${session.user.id} ORDER BY "created_at" ASC
  `;
  const brands = brandRows.map((brand) => ({ id: brand.id, name: brand.name, monogram: brand.monogram, color: brand.color, timezone: brand.timezone }));
  const accountRows = await sql<{ id: string; brand_id: string | null; provider: ProviderId; auth_method: ProviderAuthMethod; provider_account_id: string; username: string; display_name: string; avatar_url: string | null; status: "connected" | "warning" | "expired"; token_expires_at: string | Date | null; refresh_token_expires_at: string | Date | null; last_checked_at: string | Date | null }[]>`
    SELECT id, brand_id, provider, auth_method, provider_account_id, username, display_name, avatar_url, status,
      token_expires_at, refresh_token_expires_at, last_checked_at
    FROM "social_account" WHERE "owner_id" = ${session.user.id} ORDER BY "created_at" ASC
  `;
  const iso = (value: string | Date | null) => value === null ? undefined : new Date(value).toISOString();
  const accounts: SocialAccount[] = accountRows.map((account) => ({ id: account.id, brandId: account.brand_id, provider: account.provider, authMethod: account.auth_method, providerAccountId: account.provider_account_id, handle: account.username.startsWith("@") ? account.username : `@${account.username}`, displayName: account.display_name, avatarUrl: account.avatar_url ?? undefined, status: account.status, followers: "", tokenExpiresAt: iso(account.token_expires_at), refreshTokenExpiresAt: iso(account.refresh_token_expires_at), lastCheckedAt: iso(account.last_checked_at) }));

  return <RelayApp initialBrands={brands} initialAccounts={accounts} initialNow={new Date().toISOString()} user={{ name: session.user.name, email: session.user.email, role: session.user.role ?? "MEMBER" }} />;
}
