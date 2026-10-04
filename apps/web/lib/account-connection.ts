import type { SocialAccount } from "@relay/core";

export function accountReconnectUrl(account: Pick<SocialAccount, "authMethod" | "brandId">): string {
  const flow = account.authMethod === "instagram-facebook" ? "instagram" : account.authMethod;
  const query = account.brandId ? `?brandId=${encodeURIComponent(account.brandId)}` : "";
  return `/api/oauth/${flow}/start${query}`;
}

export function accountConnectionMessage(account: SocialAccount): string | undefined {
  if (account.status === "connected") return undefined;
  if (account.connectionError) {
    if (/session has been invalidated|user changed their password/i.test(account.connectionError)) {
      return "Meta invalidated this account’s session after a password change or security check. Reconnect to authorize Relay again, then retry failed posts.";
    }
    return account.connectionError.replace(/TikTok code: (190|102)\./g, "Meta code: $1.");
  }
  return account.status === "expired"
    ? "Authorization expired or was revoked. Reconnect this account, then retry failed posts."
    : "Relay could not renew this account’s authorization. It will try again automatically; you can also reconnect.";
}
