import type { ProviderAuthMethod, ProviderId } from "@relay/core";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type OAuthFlow = "facebook" | "instagram" | "instagram-standalone" | "tiktok" | "youtube";

export interface OAuthEnvironment {
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  TIKTOK_CLIENT_ID?: string;
  TIKTOK_CLIENT_SECRET?: string;
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  META_GRAPH_VERSION?: string;
}

export interface ConnectedProviderAccount {
  provider: ProviderId;
  authMethod: ProviderAuthMethod;
  providerAccountId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  refreshAfterAt: Date | null;
  grantedScopes: string[];
  providerMetadata: Record<string, unknown>;
}

export interface RefreshOAuthInput {
  providerAccountId: string;
  accessToken: string;
  refreshToken: string;
  grantedScopes: string[];
  providerMetadata: Record<string, unknown>;
}

export interface RefreshedOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  refreshTokenExpiresAt?: Date | null;
  refreshAfterAt: Date;
  grantedScopes?: string[];
}

export interface OAuthAdapter {
  flow: OAuthFlow;
  provider: ProviderId;
  authMethod: ProviderAuthMethod;
  configured: boolean;
  callbackUrl: string;
  authorizationUrl(state: string): string;
  connect(code: string): Promise<ConnectedProviderAccount[]>;
  refresh(input: RefreshOAuthInput): Promise<RefreshedOAuthTokens>;
  revoke?(input: { accessToken: string; refreshToken: string | null }): Promise<void>;
}

export interface ProviderOAuthDiagnostic {
  action: string;
  status: number;
  providerCode?: string;
  providerSubcode?: string;
  providerType?: string;
}

export class ProviderOAuthError extends Error {
  constructor(message: string, readonly reconnectRequired = false, readonly diagnostic?: ProviderOAuthDiagnostic) {
    super(message);
    this.name = "ProviderOAuthError";
  }
}

function callbackUrl(appUrl: string, flow: OAuthFlow): string {
  return `${new URL(appUrl).origin}/api/oauth/${flow}/callback`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value === "string") return value.split(/[ ,]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function expiry(seconds: unknown, fallbackSeconds: number): Date {
  return new Date(Date.now() + (asNumber(seconds) ?? fallbackSeconds) * 1_000);
}

function refreshAt(expiresAt: Date, earlyByMs: number): Date {
  return new Date(Math.max(Date.now() + MINUTE, expiresAt.getTime() - earlyByMs));
}

async function jsonRequest<T>(url: string | URL, init: RequestInit, action: string): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: "no-store" }); }
  catch { throw new ProviderOAuthError(`${action} could not reach the provider. Try again.`); }
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    const directCode = typeof record.error === "string" ? record.error : asString(record.error_code);
    const code = directCode || asString(nested.code) || (asNumber(nested.code) !== null ? String(asNumber(nested.code)) : undefined);
    const subcode = asString(nested.error_subcode) || (asNumber(nested.error_subcode) !== null ? String(asNumber(nested.error_subcode)) : undefined);
    throw new ProviderOAuthError(
      `${action} was rejected by the provider. Reconnect the account and verify the app permissions.`,
      response.status === 400 || response.status === 401 || response.status === 403,
      { action, status: response.status, providerCode: code, providerSubcode: subcode, providerType: asString(nested.type) ?? undefined },
    );
  }
  return payload as T;
}

function form(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return body;
}

interface MetaTokenResponse { access_token?: unknown; expires_in?: unknown }
interface MetaPage {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
  picture?: { data?: { url?: unknown } };
  instagram_business_account?: { id?: unknown; username?: unknown; name?: unknown; profile_picture_url?: unknown };
}

function normalizedInstagramCode(code: string): string {
  return code.endsWith("#_") ? code.slice(0, -2) : code;
}

function createMetaAdapter(flow: "facebook" | "instagram", env: OAuthEnvironment, appUrl: string): OAuthAdapter {
  const clientId = env.FACEBOOK_APP_ID ?? "";
  const clientSecret = env.FACEBOOK_APP_SECRET ?? "";
  const version = env.META_GRAPH_VERSION || "v23.0";
  const redirectUri = callbackUrl(appUrl, flow);
  const requestedScopes = flow === "facebook"
    ? ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management"]
    : ["pages_show_list", "pages_read_engagement", "business_management", "instagram_basic", "instagram_content_publish"];

  const exchangeLongLived = async (token: string) => {
    const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    url.search = form({ grant_type: "fb_exchange_token", client_id: clientId, client_secret: clientSecret, fb_exchange_token: token }).toString();
    const payload = await jsonRequest<MetaTokenResponse>(url, { method: "GET" }, "Meta token exchange");
    const accessToken = asString(payload.access_token);
    if (!accessToken) throw new ProviderOAuthError("Meta did not return an access token.");
    const expiresAt = expiry(payload.expires_in, 60 * 24 * 60 * 60);
    return { accessToken, expiresAt };
  };

  const pages = async (userToken: string): Promise<MetaPage[]> => {
    const url = new URL(`https://graph.facebook.com/${version}/me/accounts`);
    url.searchParams.set("fields", "id,name,access_token,picture{url},instagram_business_account");
    url.searchParams.set("limit", "100");
    const payload = await jsonRequest<{ data?: unknown }>(url, { headers: { Authorization: `Bearer ${userToken}` } }, "Meta account discovery");
    return Array.isArray(payload.data) ? payload.data as MetaPage[] : [];
  };

  const discoverAccounts = async (userToken: string): Promise<MetaPage[]> => {
    const discoveredPages = await pages(userToken);
    if (flow === "facebook") return discoveredPages;
    return Promise.all(discoveredPages.map(async (page) => {
      const instagramId = asString(page.instagram_business_account?.id);
      if (!instagramId) return page;
      const url = new URL(`https://graph.facebook.com/${version}/${instagramId}`);
      url.searchParams.set("fields", "id,username,name,profile_picture_url");
      const instagram = await jsonRequest<MetaPage["instagram_business_account"]>(url, { headers: { Authorization: `Bearer ${userToken}` } }, "Instagram account discovery");
      return { ...page, instagram_business_account: instagram };
    }));
  };

  const accountFromPage = (page: MetaPage, userToken: string, expiresAt: Date): ConnectedProviderAccount | null => {
    const pageId = asString(page.id); const pageToken = asString(page.access_token);
    if (!pageId || !pageToken) return null;
    const instagram = page.instagram_business_account;
    const providerAccountId = flow === "facebook" ? pageId : asString(instagram?.id);
    if (!providerAccountId) return null;
    const displayName = (flow === "facebook" ? asString(page.name) : asString(instagram?.name)) || (flow === "facebook" ? "Facebook Page" : "Instagram account");
    const username = (flow === "facebook" ? asString(page.name) : asString(instagram?.username)) || displayName;
    const avatarUrl = flow === "facebook" ? asString(page.picture?.data?.url) : asString(instagram?.profile_picture_url);
    return {
      provider: flow, authMethod: flow === "facebook" ? "facebook" : "instagram-facebook", providerAccountId,
      username, displayName, avatarUrl, accessToken: pageToken, refreshToken: userToken,
      tokenExpiresAt: expiresAt, refreshTokenExpiresAt: expiresAt, refreshAfterAt: refreshAt(expiresAt, 7 * DAY),
      grantedScopes: requestedScopes, providerMetadata: { pageId, metaGraphVersion: version },
    };
  };

  return {
    flow, provider: flow, authMethod: flow === "facebook" ? "facebook" : "instagram-facebook",
    configured: Boolean(clientId && clientSecret), callbackUrl: redirectUri,
    authorizationUrl(state) {
      const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
      url.search = form({ client_id: clientId, redirect_uri: redirectUri, state, response_type: "code", scope: requestedScopes.join(",") }).toString();
      return url.toString();
    },
    async connect(code) {
      const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
      url.search = form({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }).toString();
      const short = await jsonRequest<MetaTokenResponse>(url, { method: "GET" }, "Meta authorization");
      const shortToken = asString(short.access_token);
      if (!shortToken) throw new ProviderOAuthError("Meta did not return an access token.");
      const long = await exchangeLongLived(shortToken);
      const discovered = (await discoverAccounts(long.accessToken)).map((page) => accountFromPage(page, long.accessToken, long.expiresAt)).filter((item): item is ConnectedProviderAccount => item !== null);
      if (discovered.length === 0) throw new ProviderOAuthError(flow === "facebook" ? "No manageable Facebook Pages were found." : "No professional Instagram account linked to a Facebook Page was found.");
      return discovered;
    },
    async refresh(input) {
      const long = await exchangeLongLived(input.refreshToken);
      const discovered = (await discoverAccounts(long.accessToken)).map((page) => accountFromPage(page, long.accessToken, long.expiresAt)).find((item) => item?.providerAccountId === input.providerAccountId);
      if (!discovered) throw new ProviderOAuthError("The Meta account is no longer available to this authorization.", true);
      return { accessToken: discovered.accessToken, refreshToken: long.accessToken, expiresAt: long.expiresAt, refreshTokenExpiresAt: long.expiresAt, refreshAfterAt: discovered.refreshAfterAt!, grantedScopes: discovered.grantedScopes };
    },
  };
}

function createInstagramStandaloneAdapter(env: OAuthEnvironment, appUrl: string): OAuthAdapter {
  const clientId = env.INSTAGRAM_APP_ID ?? ""; const clientSecret = env.INSTAGRAM_APP_SECRET ?? "";
  const version = env.META_GRAPH_VERSION || "v23.0";
  const redirectUri = callbackUrl(appUrl, "instagram-standalone");
  const requestedScopes = ["instagram_business_basic", "instagram_business_content_publish"];
  return {
    flow: "instagram-standalone", provider: "instagram", authMethod: "instagram-standalone", configured: Boolean(clientId && clientSecret), callbackUrl: redirectUri,
    authorizationUrl(state) {
      const url = new URL("https://www.instagram.com/oauth/authorize");
      url.search = form({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: requestedScopes.join(","), state, enable_fb_login: "0", force_authentication: "1" }).toString();
      return url.toString();
    },
    async connect(code) {
      const short = await jsonRequest<{ access_token?: unknown; user_id?: unknown; permissions?: unknown }>("https://api.instagram.com/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: normalizedInstagramCode(code) }) }, "Instagram authorization");
      const shortToken = asString(short.access_token);
      if (!shortToken) throw new ProviderOAuthError("Instagram did not return an access token.");
      const longUrl = new URL("https://graph.instagram.com/access_token");
      longUrl.search = form({ grant_type: "ig_exchange_token", client_id: clientId, client_secret: clientSecret, access_token: shortToken }).toString();
      const long = await jsonRequest<{ access_token?: unknown; expires_in?: unknown }>(longUrl, { method: "GET" }, "Instagram long-lived token exchange");
      const accessToken = asString(long.access_token);
      if (!accessToken) throw new ProviderOAuthError("Instagram did not return a long-lived access token.");
      const profileUrl = new URL(`https://graph.instagram.com/${version}/me`);
      profileUrl.searchParams.set("fields", "user_id,username,name,profile_picture_url");
      const profile = await jsonRequest<{ id?: unknown; user_id?: unknown; username?: unknown; name?: unknown; profile_picture_url?: unknown }>(profileUrl, { headers: { Authorization: `Bearer ${accessToken}` } }, "Instagram profile discovery");
      const providerAccountId = asString(profile.user_id) || asString(profile.id) || String(short.user_id || "");
      if (!providerAccountId) throw new ProviderOAuthError("Instagram did not return an account identifier.");
      const username = asString(profile.username) || "instagram"; const displayName = asString(profile.name) || username;
      const expiresAt = expiry(long.expires_in, 60 * 24 * 60 * 60);
      const grantedScopes = scopes(short.permissions);
      return [{ provider: "instagram", authMethod: "instagram-standalone", providerAccountId, username, displayName, avatarUrl: asString(profile.profile_picture_url), accessToken, refreshToken: accessToken, tokenExpiresAt: expiresAt, refreshTokenExpiresAt: expiresAt, refreshAfterAt: refreshAt(expiresAt, 10 * DAY), grantedScopes: grantedScopes.length ? grantedScopes : requestedScopes, providerMetadata: { metaGraphVersion: version } }];
    },
    async refresh(input) {
      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.search = form({ grant_type: "ig_refresh_token", access_token: input.refreshToken }).toString();
      const payload = await jsonRequest<{ access_token?: unknown; expires_in?: unknown }>(url, { method: "GET" }, "Instagram token refresh");
      const accessToken = asString(payload.access_token);
      if (!accessToken) throw new ProviderOAuthError("Instagram did not return a refreshed token.", true);
      const expiresAt = expiry(payload.expires_in, 60 * 24 * 60 * 60);
      return { accessToken, refreshToken: accessToken, expiresAt, refreshTokenExpiresAt: expiresAt, refreshAfterAt: refreshAt(expiresAt, 10 * DAY), grantedScopes: input.grantedScopes };
    },
  };
}

function createTikTokAdapter(env: OAuthEnvironment, appUrl: string): OAuthAdapter {
  const clientId = env.TIKTOK_CLIENT_ID ?? ""; const clientSecret = env.TIKTOK_CLIENT_SECRET ?? "";
  const redirectUri = callbackUrl(appUrl, "tiktok"); const requestedScopes = ["user.info.basic", "video.publish", "video.upload"];
  const tokenRequest = async (body: URLSearchParams, action: string) => jsonRequest<{ access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; refresh_expires_in?: unknown; open_id?: unknown; scope?: unknown }>("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, action);
  return {
    flow: "tiktok", provider: "tiktok", authMethod: "tiktok", configured: Boolean(clientId && clientSecret), callbackUrl: redirectUri,
    authorizationUrl(state) {
      const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
      url.search = form({ client_key: clientId, redirect_uri: redirectUri, response_type: "code", scope: requestedScopes.join(","), state }).toString();
      return url.toString();
    },
    async connect(code) {
      const token = await tokenRequest(form({ client_key: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }), "TikTok authorization");
      const accessToken = asString(token.access_token); const refreshToken = asString(token.refresh_token); const providerAccountId = asString(token.open_id);
      if (!accessToken || !refreshToken || !providerAccountId) throw new ProviderOAuthError("TikTok did not return the required authorization tokens.");
      const profileUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
      profileUrl.searchParams.set("fields", "open_id,union_id,avatar_url,display_name,username");
      const profile = await jsonRequest<{ data?: { user?: { username?: unknown; display_name?: unknown; avatar_url?: unknown } } }>(profileUrl, { headers: { Authorization: `Bearer ${accessToken}` } }, "TikTok profile discovery");
      const user = profile.data?.user; const username = asString(user?.username) || asString(user?.display_name) || "tiktok"; const displayName = asString(user?.display_name) || username;
      const expiresAt = expiry(token.expires_in, 24 * 60 * 60); const refreshExpiresAt = expiry(token.refresh_expires_in, 365 * 24 * 60 * 60);
      const grantedScopes = scopes(token.scope); return [{ provider: "tiktok", authMethod: "tiktok", providerAccountId, username, displayName, avatarUrl: asString(user?.avatar_url), accessToken, refreshToken, tokenExpiresAt: expiresAt, refreshTokenExpiresAt: refreshExpiresAt, refreshAfterAt: refreshAt(expiresAt, 30 * MINUTE), grantedScopes: grantedScopes.length ? grantedScopes : requestedScopes, providerMetadata: {} }];
    },
    async refresh(input) {
      const token = await tokenRequest(form({ client_key: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: input.refreshToken }), "TikTok token refresh");
      const accessToken = asString(token.access_token); const refreshToken = asString(token.refresh_token);
      if (!accessToken || !refreshToken) throw new ProviderOAuthError("TikTok did not return refreshed authorization tokens.", true);
      const expiresAt = expiry(token.expires_in, 24 * 60 * 60); const refreshExpiresAt = expiry(token.refresh_expires_in, 365 * 24 * 60 * 60);
      return { accessToken, refreshToken, expiresAt, refreshTokenExpiresAt: refreshExpiresAt, refreshAfterAt: refreshAt(expiresAt, 30 * MINUTE), grantedScopes: scopes(token.scope).length ? scopes(token.scope) : input.grantedScopes };
    },
    async revoke(input) {
      await jsonRequest("https://open.tiktokapis.com/v2/oauth/revoke/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_key: clientId, client_secret: clientSecret, token: input.accessToken }) }, "TikTok disconnect");
    },
  };
}

function createYouTubeAdapter(env: OAuthEnvironment, appUrl: string): OAuthAdapter {
  const clientId = env.YOUTUBE_CLIENT_ID ?? ""; const clientSecret = env.YOUTUBE_CLIENT_SECRET ?? "";
  const redirectUri = callbackUrl(appUrl, "youtube"); const requestedScopes = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
  const tokenRequest = async (body: URLSearchParams, action: string) => jsonRequest<{ access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown }>("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, action);
  return {
    flow: "youtube", provider: "youtube", authMethod: "youtube", configured: Boolean(clientId && clientSecret), callbackUrl: redirectUri,
    authorizationUrl(state) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = form({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: requestedScopes.join(" "), state, access_type: "offline", prompt: "consent", include_granted_scopes: "true" }).toString();
      return url.toString();
    },
    async connect(code) {
      const token = await tokenRequest(form({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }), "YouTube authorization");
      const accessToken = asString(token.access_token); const refreshToken = asString(token.refresh_token);
      if (!accessToken || !refreshToken) throw new ProviderOAuthError("YouTube did not return offline access. Remove Relay from Google permissions and connect again.");
      const profileUrl = new URL("https://www.googleapis.com/youtube/v3/channels"); profileUrl.search = form({ part: "snippet", mine: "true" }).toString();
      const profile = await jsonRequest<{ items?: Array<{ id?: unknown; snippet?: { title?: unknown; customUrl?: unknown; thumbnails?: { default?: { url?: unknown } } } }> }>(profileUrl, { headers: { Authorization: `Bearer ${accessToken}` } }, "YouTube channel discovery");
      const channel = profile.items?.[0]; const providerAccountId = asString(channel?.id);
      if (!providerAccountId) throw new ProviderOAuthError("No YouTube channel was found for this Google account.");
      const displayName = asString(channel?.snippet?.title) || "YouTube channel"; const username = asString(channel?.snippet?.customUrl) || displayName;
      const expiresAt = expiry(token.expires_in, 60 * 60); const grantedScopes = scopes(token.scope);
      return [{ provider: "youtube", authMethod: "youtube", providerAccountId, username, displayName, avatarUrl: asString(channel?.snippet?.thumbnails?.default?.url), accessToken, refreshToken, tokenExpiresAt: expiresAt, refreshTokenExpiresAt: null, refreshAfterAt: refreshAt(expiresAt, 10 * MINUTE), grantedScopes: grantedScopes.length ? grantedScopes : requestedScopes, providerMetadata: {} }];
    },
    async refresh(input) {
      const token = await tokenRequest(form({ client_id: clientId, client_secret: clientSecret, refresh_token: input.refreshToken, grant_type: "refresh_token" }), "YouTube token refresh");
      const accessToken = asString(token.access_token); if (!accessToken) throw new ProviderOAuthError("YouTube did not return a refreshed token.", true);
      const expiresAt = expiry(token.expires_in, 60 * 60);
      return { accessToken, expiresAt, refreshAfterAt: refreshAt(expiresAt, 10 * MINUTE), grantedScopes: scopes(token.scope).length ? scopes(token.scope) : input.grantedScopes };
    },
    async revoke(input) {
      await jsonRequest("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ token: input.refreshToken || input.accessToken }) }, "YouTube disconnect");
    },
  };
}

export class OAuthProviderRegistry {
  private readonly adapters: OAuthAdapter[];
  constructor(env: OAuthEnvironment, appUrl: string) {
    this.adapters = [createMetaAdapter("facebook", env, appUrl), createMetaAdapter("instagram", env, appUrl), createInstagramStandaloneAdapter(env, appUrl), createTikTokAdapter(env, appUrl), createYouTubeAdapter(env, appUrl)];
  }
  get(flow: string): OAuthAdapter {
    const adapter = this.adapters.find((item) => item.flow === flow);
    if (!adapter) throw new ProviderOAuthError("Unsupported social provider.");
    return adapter;
  }
  getByAuthMethod(method: ProviderAuthMethod): OAuthAdapter {
    const adapter = this.adapters.find((item) => item.authMethod === method);
    if (!adapter) throw new ProviderOAuthError("Unsupported account authorization method.", true);
    return adapter;
  }
  list(): OAuthAdapter[] { return [...this.adapters]; }
}
