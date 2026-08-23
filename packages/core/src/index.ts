export type ProviderId = "instagram" | "facebook" | "tiktok" | "youtube";
export type ProviderAuthMethod = "instagram-facebook" | "instagram-standalone" | "facebook" | "tiktok" | "youtube";
export type AccountStatus = "connected" | "warning" | "expired";
export type PostStatus = "draft" | "scheduled" | "publishing" | "processing" | "published" | "failed";

export interface Brand {
  id: string;
  name: string;
  monogram: string;
  color: string;
  timezone: string;
}

export interface SocialAccount {
  id: string;
  brandId: string | null;
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
  analytics?: PostAnalytics;
}

export interface PostAnalytics {
  capturedAt: string;
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  watchTimeSeconds?: number;
  averageWatchTimeSeconds?: number;
}

export interface RelayPost {
  id: string;
  brandId: string;
  text: string;
  mediaType: "image" | "video" | "none";
  mediaUrl?: string;
  mediaUrls?: string[];
  status: PostStatus;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt?: string;
  targets: PostTarget[];
}

export type SlideshowTextPosition = "top" | "center" | "bottom";
export type SlideshowTextBackground = "none" | "dark" | "light";

export interface SlideshowSlide {
  id: string;
  mediaUrl: string;
  renderedUrl?: string;
  text?: string;
  fit: "cover" | "contain";
  textPosition: SlideshowTextPosition;
  textSize: number;
  textColor: string;
  textBackground: SlideshowTextBackground;
}

export interface SlideshowProject {
  id: string;
  brandId: string;
  name: string;
  caption: string;
  slides: SlideshowSlide[];
  createdAt: string;
  updatedAt: string;
}

export const brands: Brand[] = [];
export const accounts: SocialAccount[] = [];
export const initialPosts: RelayPost[] = [];
