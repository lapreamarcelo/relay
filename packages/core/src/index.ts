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
  textOverride?: string;
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
  campaignId?: string;
  campaignName?: string;
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

export interface Campaign {
  id: string;
  brandId: string;
  name: string;
  color: string;
  status: "active" | "archived";
  postCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PostTemplate {
  id: string;
  brandId: string;
  name: string;
  text: string;
  mediaType: "image" | "video" | "none";
  settings: Partial<Record<ProviderId, ProviderPostSettings>>;
  createdAt: string;
  updatedAt: string;
}

export type SlideshowTextPosition = "top" | "center" | "bottom";
export type SlideshowTextBackground = "none" | "dark" | "light";
export type LabelStylePreset = "dark" | "light" | "outline";
export type LabelFont = "modern" | "editorial" | "mono";
export type MediaAssetKind = "media" | "music";

export interface AssetFolder {
  id: string;
  name: string;
  kind: MediaAssetKind;
  count: number;
  createdAt: string;
}

export interface CreativeLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  fontSize: number;
  font: LabelFont;
  textColor: string;
  background: SlideshowTextBackground;
  backgroundColor?: string;
  style: LabelStylePreset;
}

export interface SlideshowSlide {
  id: string;
  mediaUrl: string;
  renderedUrl?: string;
  text?: string;
  fit: "cover" | "contain";
  textPosition: SlideshowTextPosition;
  textX?: number;
  textY?: number;
  textWidth?: number;
  textHeight?: number;
  textSize: number;
  textFont: LabelFont;
  textColor: string;
  textBackground: SlideshowTextBackground;
  textBackgroundColor?: string;
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

export interface VideoProject {
  id: string;
  brandId: string;
  name: string;
  caption: string;
  sourceUrl: string;
  sourceFolderId?: string;
  musicUrl?: string;
  musicFolderId?: string;
  labels: CreativeLabel[];
  renderedUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type VideoMusicMode = "none" | "fixed" | "rotate" | "random";

export const brands: Brand[] = [];
export const accounts: SocialAccount[] = [];
export const initialPosts: RelayPost[] = [];
