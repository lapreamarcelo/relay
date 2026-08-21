import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { AccountCredential, AccountCredentialRepository, RotatedAccountTokens } from "@relay/core/account-credentials";
import { AesGcmTokenCipher } from "@relay/core/token-encryption";
import { ProviderAuthorizationError, ProviderRefreshRegistry } from "@relay/providers/token-refresh";
import { AccountReconnectRequiredError, TokenLifecycleService, TokenRefreshInProgressError } from "./token-lifecycle.ts";

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
    Object.assign(account, tokens, { status: "connected", lastCheckedAt: checkedAt, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
  }

  async markRefreshWarning(accountId: string, leaseOwner: string, checkedAt: Date): Promise<void> {
    const account = this.withLease(accountId, leaseOwner);
    Object.assign(account, { status: "warning", lastCheckedAt: checkedAt, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
  }

  async markExpired(accountId: string, leaseOwner: string, checkedAt: Date): Promise<void> {
    const account = this.withLease(accountId, leaseOwner);
    Object.assign(account, { status: "expired", lastCheckedAt: checkedAt, refreshLeaseOwner: null, refreshLeaseExpiresAt: null });
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
