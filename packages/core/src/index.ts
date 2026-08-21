export type ProviderId = "instagram" | "facebook" | "tiktok" | "youtube";
export type ProviderAuthMethod = "instagram-facebook" | "instagram-standalone" | "facebook" | "tiktok" | "youtube";
export type AccountStatus = "connected" | "warning" | "expired";
export type PostStatus = "draft" | "scheduled" | "published" | "failed";

export interface Brand {
  id: string;
  name: string;
  monogram: string;
  color: string;
  timezone: string;
}

export interface SocialAccount {
  id: string;
  brandId: string;
  provider: ProviderId;
  authMethod: ProviderAuthMethod;
  providerAccountId: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  status: AccountStatus;
  followers: string;
  tokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  lastCheckedAt?: string;
}

export interface InstagramPostSettings {
  kind: "instagram";
  publishType: "feed" | "reel" | "story";
}

export interface FacebookPostSettings {
  kind: "facebook";
  publishType: "feed" | "reel";
  linkUrl?: string;
}

export interface TikTokPostSettings {
  kind: "tiktok";
  privacyLevel: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
  allowComments: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
}

export interface YouTubePostSettings {
  kind: "youtube";
  title: string;
  tags: string[];
  privacyStatus: "private" | "unlisted" | "public";
  madeForKids: boolean;
}

export type ProviderPostSettings =
  | InstagramPostSettings
  | FacebookPostSettings
  | TikTokPostSettings
  | YouTubePostSettings;

export interface PostTarget {
  id: string;
  accountId: string;
  provider: ProviderId;
  status: PostStatus;
  settings: ProviderPostSettings;
  externalUrl?: string;
  error?: string;
}

export interface RelayPost {
  id: string;
  brandId: string;
  text: string;
  mediaType: "image" | "video" | "none";
  mediaUrl?: string;
  status: PostStatus;
  scheduledAt?: string;
  publishedAt?: string;
  targets: PostTarget[];
}

export const brands: Brand[] = [];
export const accounts: SocialAccount[] = [];
export const initialPosts: RelayPost[] = [];
