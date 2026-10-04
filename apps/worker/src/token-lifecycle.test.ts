import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { AccountCredential, AccountCredentialRepository, RotatedAccountTokens } from "@relay/core/account-credentials";
import { AesGcmTokenCipher } from "@relay/core/token-encryption";
import { ProviderAuthorizationError, ProviderRefreshRegistry } from "@relay/providers/token-refresh";
import { AccountReconnectRequiredError, TokenLifecycleService, TokenRefreshInProgressError } from "./token-lifecycle.ts";
import { ProviderPublishError } from "@relay/providers/publish";
import { withFreshAccountToken } from "./publisher-auth.ts";

class MemoryCredentialRepository implements AccountCredentialRepository {
  constructor(readonly accounts: AccountCredential[]) {}

  async findByAccountId(accountId: string): Promise<AccountCredential | null> {
    return this.accounts.find((account) => account.accountId === accountId) ?? null;
  }

  async findRefreshCandidates(refreshBefore: Date, limit: number): Promise<AccountCredential[]> {
    return this.accounts.filter((account) =>
      account.status !== "expired" &&
      account.refreshAfterAt !== null &&
      account.refreshAfterAt <= refreshBefore &&
      (!account.refreshLeaseExpiresAt || account.refreshLeaseExpiresAt <= new Date()),
    ).slice(0, limit);
  }

  async claimRefresh(accountId: string, leaseOwner: string, leaseExpiresAt: Date): Promise<AccountCredential | null> {
    const account = await this.findByAccountId(accountId);
    if (!account || account.status === "expired") return null;
    if (account.refreshLeaseExpiresAt && account.refreshLeaseExpiresAt > new Date()) return null;
    account.refreshLeaseOwner = leaseOwner;
    account.refreshLeaseExpiresAt = leaseExpiresAt;
    return account;
  }

  async saveRefreshed(accountId: string, leaseOwner: string, tokens: RotatedAccountTokens, checkedAt: Date): Promise<void> {
    const account = this.withLease(accountId, leaseOwner);
    Object.assign(account, tokens, { status: "connected", connectionError: null, lastCheckedAt: checkedAt, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
  }

  async markRefreshWarning(accountId: string, leaseOwner: string, checkedAt: Date): Promise<void> {
    const account = this.withLease(accountId, leaseOwner);
    Object.assign(account, { status: "warning", lastCheckedAt: checkedAt, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
  }

  async markExpired(accountId: string, leaseOwner: string, checkedAt: Date, reason?: string): Promise<void> {
    const account = this.withLease(accountId, leaseOwner);
    Object.assign(account, { status: "expired", connectionError: reason, lastCheckedAt: checkedAt, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
  }

  async markAuthorizationRejected(accountId: string, accessTokenEncrypted: string, reason: string, checkedAt: Date): Promise<void> {
    const account = await this.findByAccountId(accountId);
    if (account?.accessTokenEncrypted === accessTokenEncrypted) Object.assign(account, { status: "expired", connectionError: reason, lastCheckedAt: checkedAt });
  }

  private withLease(accountId: string, leaseOwner: string): AccountCredential {
    const account = this.accounts.find((item) => item.accountId === accountId);
    if (!account || account.refreshLeaseOwner !== leaseOwner) throw new Error("Refresh lease was lost");
    return account;
  }
}

const now = new Date();

function setup(overrides: Partial<AccountCredential> = {}) {
  const cipher = new AesGcmTokenCipher(randomBytes(32));
  const account: AccountCredential = {
    accountId: "account-1",
    provider: "tiktok",
    authMethod: "tiktok",
    providerAccountId: "provider-account-1",
    providerMetadata: {},
    accessTokenEncrypted: cipher.encrypt("access-old"),
    refreshTokenEncrypted: cipher.encrypt("refresh-old"),
    tokenExpiresAt: new Date(now.getTime() + 5 * 60_000),
    refreshTokenExpiresAt: new Date(now.getTime() + 300 * 24 * 60 * 60_000),
    refreshAfterAt: new Date(now.getTime() - 1),
    grantedScopes: ["video.publish"],
    status: "connected",
    lastCheckedAt: null,
    refreshLeaseOwner: null,
    refreshLeaseExpiresAt: null,
    ...overrides,
  };
  const repository = new MemoryCredentialRepository([account]);
  const providers = new ProviderRefreshRegistry();
  return { cipher, account, repository, providers };
}

test("returns the existing token before its provider-specific refresh time", async () => {
  const context = setup({ tokenExpiresAt: new Date(now.getTime() + 60 * 60_000), refreshAfterAt: new Date(now.getTime() + 50 * 60_000) });
  let calls = 0;
  context.providers.register("tiktok", async () => { calls += 1; throw new Error("must not refresh"); });
  const lifecycle = new TokenLifecycleService(context.repository, context.cipher, context.providers);

  assert.equal(await lifecycle.getValidAccessToken("account-1", now), "access-old");
  assert.equal(calls, 0);
});

test("refreshes early and persists rotated access and refresh tokens", async () => {
  const context = setup();
  context.providers.register("tiktok", async ({ refreshToken }) => {
    assert.equal(refreshToken, "refresh-old");
    return {
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      refreshTokenExpiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60_000),
      refreshAfterAt: new Date(now.getTime() + 23 * 60 * 60_000),
    };
  });
  const lifecycle = new TokenLifecycleService(context.repository, context.cipher, context.providers);

  assert.equal(await lifecycle.getValidAccessToken("account-1", now), "access-new");
  assert.equal(context.cipher.decrypt(context.account.accessTokenEncrypted), "access-new");
  assert.equal(context.cipher.decrypt(context.account.refreshTokenEncrypted!), "refresh-new");
  assert.equal(context.account.status, "connected");
  assert.equal(context.account.refreshLeaseOwner, null);
});

test("marks an account expired when no usable refresh token exists", async () => {
  const context = setup({ refreshTokenEncrypted: null });
  const lifecycle = new TokenLifecycleService(context.repository, context.cipher, context.providers);

  await assert.rejects(() => lifecycle.getValidAccessToken("account-1", now), AccountReconnectRequiredError);
  assert.equal(context.account.status, "expired");
});

test("marks revoked authorization expired and transient failures warning", async () => {
  const revoked = setup();
  revoked.providers.register("tiktok", async () => { throw new ProviderAuthorizationError("revoked", true); });
  await assert.rejects(
    () => new TokenLifecycleService(revoked.repository, revoked.cipher, revoked.providers).getValidAccessToken("account-1", now),
    AccountReconnectRequiredError,
  );
  assert.equal(revoked.account.status, "expired");

  const transient = setup();
  transient.providers.register("tiktok", async () => { throw new Error("provider unavailable"); });
  await assert.rejects(
    () => new TokenLifecycleService(transient.repository, transient.cipher, transient.providers).getValidAccessToken("account-1", now),
    /provider unavailable/,
  );
  assert.equal(transient.account.status, "warning");
});

test("a refresh lease prevents two workers from rotating the same account", async () => {
  const context = setup();
  let completeRefresh!: () => void;
  const gate = new Promise<void>((resolve) => { completeRefresh = resolve; });
  let calls = 0;
  context.providers.register("tiktok", async () => {
    calls += 1;
    await gate;
    return { accessToken: "access-new", expiresAt: new Date(now.getTime() + 60 * 60_000), refreshAfterAt: new Date(now.getTime() + 50 * 60_000) };
  });
  const firstWorker = new TokenLifecycleService(context.repository, context.cipher, context.providers, { workerId: "first" });
  const secondWorker = new TokenLifecycleService(context.repository, context.cipher, context.providers, { workerId: "second" });

  const first = firstWorker.getValidAccessToken("account-1", now);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => secondWorker.getValidAccessToken("account-1", now), TokenRefreshInProgressError);
  completeRefresh();

  assert.equal(await first, "access-new");
  assert.equal(calls, 1);
});

test("the maintenance sweep refreshes due accounts before publishing", async () => {
  const context = setup();
  context.providers.register("tiktok", async () => ({ accessToken: "access-swept", expiresAt: new Date(now.getTime() + 60 * 60_000), refreshAfterAt: new Date(now.getTime() + 50 * 60_000) }));
  const lifecycle = new TokenLifecycleService(context.repository, context.cipher, context.providers);

  assert.deepEqual(await lifecycle.sweep(now), { examined: 1, refreshed: 1, reconnectRequired: 0, deferred: 0 });
  assert.equal(context.cipher.decrypt(context.account.accessTokenEncrypted), "access-swept");
});

test("publishing a revoked token expires the account and preserves the reason", async () => {
  const context = setup({ refreshAfterAt: new Date(now.getTime() + 60 * 60_000) });
  const lifecycle = new TokenLifecycleService(context.repository, context.cipher, context.providers);
  const failure = new ProviderPublishError("Meta invalidated the session after a password change.", false, true);
  await assert.rejects(() => withFreshAccountToken(lifecycle, "account-1", async () => { throw failure; }), (error) => error === failure);
  assert.equal(context.account.status, "expired");
  assert.equal(context.account.connectionError, failure.message);
  await assert.rejects(() => lifecycle.getValidAccessToken("account-1"), (error) => error instanceof AccountReconnectRequiredError && error.message === failure.message);
});

test("media and transient publishing failures do not expire authorization", async () => {
  for (const retryable of [false, true]) {
    const context = setup({ refreshAfterAt: new Date(now.getTime() + 60 * 60_000) });
    const lifecycle = new TokenLifecycleService(context.repository, context.cipher, context.providers);
    await assert.rejects(() => withFreshAccountToken(lifecycle, "account-1", async () => { throw new ProviderPublishError("Media failed", retryable); }));
    assert.equal(context.account.status, "connected");
  }
});

test("an old publish failure cannot invalidate reconnected credentials", async () => {
  const context = setup({ refreshAfterAt: new Date(now.getTime() + 60 * 60_000) });
  const lifecycle = new TokenLifecycleService(context.repository, context.cipher, context.providers);
  await assert.rejects(() => withFreshAccountToken(lifecycle, "account-1", async () => {
    context.account.accessTokenEncrypted = context.cipher.encrypt("reconnected-token");
    throw new ProviderPublishError("Old token rejected", false, true);
  }));
  assert.equal(context.account.status, "connected");
  assert.equal(await lifecycle.getValidAccessToken("account-1"), "reconnected-token");
});

test("a successful in-flight refresh can recover a rejected publish token", async () => {
  const context = setup();
  let completeRefresh!: () => void;
  const gate = new Promise<void>((resolve) => { completeRefresh = resolve; });
  context.providers.register("tiktok", async () => {
    await gate;
    return { accessToken: "access-new", expiresAt: new Date(now.getTime() + 60 * 60_000), refreshAfterAt: new Date(now.getTime() + 50 * 60_000) };
  });
  const lifecycle = new TokenLifecycleService(context.repository, context.cipher, context.providers);
  const refresh = lifecycle.getValidAccessToken("account-1", now);
  await new Promise((resolve) => setImmediate(resolve));
  const lease = context.account.refreshLeaseOwner;
  await lifecycle.markAuthorizationRejected("account-1", "access-old", "Old token rejected", now);
  assert.equal(context.account.status, "expired");
  assert.equal(context.account.refreshLeaseOwner, lease);
  completeRefresh();
  assert.equal(await refresh, "access-new");
  assert.equal(context.account.status, "connected");
  assert.equal(context.account.connectionError, null);
});
