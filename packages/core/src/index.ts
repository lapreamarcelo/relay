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
  connectionError?: string;
}

export interface InstagramPostSettings {
  kind: "instagram";
  publishType: "feed" | "reel" | "story";
  /** Public JPEG URL used as the Reel cover. Takes precedence over thumbOffsetMs. */
  coverUrl?: string;
  /** Video frame, in milliseconds, used as the Reel cover when coverUrl is absent. */
  thumbOffsetMs?: number;
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
  /** Video frame, in milliseconds, used as the cover for Direct Posts. */
  thumbOffsetMs?: number;
}

export interface YouTubePostSettings {
  kind: "youtube";
  title: string;
  tags: string[];
  privacyStatus: "private" | "unlisted" | "public";
  madeForKids: boolean;
  /** Public JPEG or PNG URL uploaded as the video's custom thumbnail after the video is created. */
  thumbnailUrl?: string;
}

export type ProviderPostSettings =
  | InstagramPostSettings
  | FacebookPostSettings
  | TikTokPostSettings
  | YouTubePostSettings;

export interface PublishingDefaults {
  instagram: {
    imagePublishType: "feed" | "story";
    videoPublishType: "feed" | "reel" | "story";
  };
  facebook: {
    videoPublishType: "feed" | "reel";
  };
  tiktok: {
    privacyLevel: TikTokPostSettings["privacyLevel"];
    allowComments: boolean;
    allowDuet: boolean;
    allowStitch: boolean;
  };
  youtube: {
    privacyStatus: YouTubePostSettings["privacyStatus"];
    madeForKids: boolean;
  };
}

export const defaultPublishingDefaults: PublishingDefaults = {
  instagram: { imagePublishType: "feed", videoPublishType: "reel" },
  facebook: { videoPublishType: "reel" },
  tiktok: { privacyLevel: "SELF_ONLY", allowComments: true, allowDuet: false, allowStitch: false },
  youtube: { privacyStatus: "public", madeForKids: false },
};

export function normalizePublishingDefaults(value: unknown): PublishingDefaults {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const object = (key: string) => input[key] && typeof input[key] === "object" && !Array.isArray(input[key]) ? input[key] as Record<string, unknown> : {};
  const instagram = object("instagram"); const facebook = object("facebook"); const tiktok = object("tiktok"); const youtube = object("youtube");
  const oneOf = <T extends string>(candidate: unknown, options: readonly T[], fallback: T): T => typeof candidate === "string" && options.includes(candidate as T) ? candidate as T : fallback;
  const bool = (candidate: unknown, fallback: boolean) => typeof candidate === "boolean" ? candidate : fallback;
  return {
    instagram: {
      imagePublishType: oneOf(instagram.imagePublishType, ["feed", "story"] as const, defaultPublishingDefaults.instagram.imagePublishType),
      videoPublishType: oneOf(instagram.videoPublishType, ["feed", "reel", "story"] as const, defaultPublishingDefaults.instagram.videoPublishType),
    },
    facebook: { videoPublishType: oneOf(facebook.videoPublishType, ["feed", "reel"] as const, defaultPublishingDefaults.facebook.videoPublishType) },
    tiktok: {
      privacyLevel: oneOf(tiktok.privacyLevel, ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const, defaultPublishingDefaults.tiktok.privacyLevel),
      allowComments: bool(tiktok.allowComments, defaultPublishingDefaults.tiktok.allowComments),
      allowDuet: bool(tiktok.allowDuet, defaultPublishingDefaults.tiktok.allowDuet),
      allowStitch: bool(tiktok.allowStitch, defaultPublishingDefaults.tiktok.allowStitch),
    },
    youtube: {
      privacyStatus: oneOf(youtube.privacyStatus, ["private", "unlisted", "public"] as const, defaultPublishingDefaults.youtube.privacyStatus),
      madeForKids: bool(youtube.madeForKids, defaultPublishingDefaults.youtube.madeForKids),
    },
  };
}

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
  paused?: boolean;
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
  parentId?: string | null;
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
  fontWeight?: 400 | 700 | 800;
  kerning?: boolean;
  textAlign?: "left" | "center" | "right";
  letterSpacing?: number;
  lineHeight?: number;
  italic?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
  backgroundOpacity?: number;
  backgroundRadius?: number;
  padding?: number;
  sceneLayer?: "overlay" | "scene" | "back";
  sceneDepth?: number;
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
  deviceFrame?: DeviceFrame;
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
  renderedCoverUrl?: string;
  timeline?: VideoTimeline;
  revision?: number;
  templateId?: string;
  createdAt: string;
  updatedAt: string;
}

export type VideoMusicMode = "none" | "fixed" | "rotate" | "random";

export type AnimationEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring" | "bouncy" | "cubic-bezier";
export interface AnimationCurve {
  controlPoints?: [number, number, number, number];
  stiffness?: number; damping?: number; mass?: number; velocity?: number;
}
export interface AnimationEffect {
  preset: "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "pop" | "zoom" | "typewriter" | "letter-rise" | "word-spring" | "line-cascade" | "tracking" | "soft-reveal" | "focus" | "ripple" | "spin-in" | "letter-drop" | "letter-slide" | "word-slide" | "word-blur" | "line-wipe" | "letter-zoom" | "word-zoom" | "letter-flip" | "wave-rise" | "arc-in" | "bounce-in" | "elastic-in" | "scatter-in" | "wipe-left" | "wipe-right" | "mask-up" | "mask-down" | "pulse-reveal" | "alternating-rise" | "ink-reveal";
  durationMs: number;
  easing?: AnimationEasing;
  curve?: AnimationCurve;
  staggerMs?: number;
}
export interface LayerKeyframe {
  /** Local time within the clip or label. Sparse properties interpolate independently. */
  timeMs: number;
  /** Curve used from this keyframe to the next authored value. */
  easing?: AnimationEasing;
  curve?: AnimationCurve;
  x?: number; y?: number; scale?: number;
  rotateX?: number; rotateY?: number; rotateZ?: number;
  foldAngle?: number; opacity?: number; depth?: number;
}
export interface LayerAnimation {
  entrance?: AnimationEffect; exit?: AnimationEffect; keyframes?: LayerKeyframe[];
  scaleMode?: "linear" | "perceptual";
  /** Omitted keeps the final pose. A return blends the final key back to rest. */
  returnMs?: number;
}
export interface ClipTransition {
  kind: "crossfade" | "slide-left" | "slide-right" | "wipe-left" | "wipe-right" | "zoom";
  durationMs: number;
  easing?: AnimationEasing;
  curve?: AnimationCurve;
}

export interface VideoSceneKeyframe extends LayerKeyframe { z?: number; focalLength?: number }
export interface VideoScene {
  version: 1;
  camera: { x: number; y: number; z: number; rotateX: number; rotateY: number; rotateZ: number; focalLength: number; keyframes?: VideoSceneKeyframe[] };
  environment: "studio" | "softbox" | "sunset" | "night";
  exposure: number; roughness: number; metallic: number; shadow: number;
  lightAngle: number; focusDepth: number; aperture: number;
  motionBlur: number;
}

export interface DeviceFrame {
  device: "phone" | "tablet" | "browser" | "iphone" | "iphone-duo" | "mac" | "watch" | "android";
  background: string;
  color: string;
  backgroundEnd?: string;
  /** Center in normalized canvas coordinates. Video timelines only. */
  x?: number;
  y?: number;
  scale?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  /** Total angle between the two hinged halves, in degrees (iPhone Duo only). */
  foldAngle?: number;
  motion?: "none" | "orbit" | "float" | "fold" | "unfold" | "fold-cycle";
  motionDurationMs?: number;
  motionEasing?: AnimationEasing;
  animation?: LayerAnimation;
  renderMode?: "vector" | "mesh" | "gpu";
  /** Bundled model/variant; omitted selects the device's default. */
  modelId?: string;
  finish?: "graphite" | "silver" | "gold" | "natural";
  band?: "woven" | "none";
  /** Shared scene is injected at render time; standalone frames may own one. */
  scene?: VideoScene;
  depth?: number;
}

export const brands: Brand[] = [];
export const accounts: SocialAccount[] = [];
export const initialPosts: RelayPost[] = [];


export interface VideoClip {
  id: string;
  sourceUrl: string;
  name: string;
  kind: "video" | "image";
  inMs: number;
  outMs: number;
  sourceDurationMs?: number;
  fit: "cover" | "contain";
  x: number;
  y: number;
  zoom: number;
  volume: number;
  speed?: number;
  /** Source timestamp held for this clip's authored duration. */
  freezeMs?: number;
  groupId?: string;
  /** Local motion continues from this offset across linked source cuts. */
  motionOffsetMs?: number;
  pointer?: VideoPointerTrack;
  deviceFrame?: DeviceFrame;
  /** Incoming overlap with the preceding clip, capped at half of each clip. */
  transition?: ClipTransition;
}
/** Independently timed visual/audio layer. Array order is back to front. */
export type VideoLayer = Omit<VideoClip, "transition"> & { startMs: number };
export interface TimedVideoLabel extends CreativeLabel { startMs: number; endMs: number; animation?: LayerAnimation }
/** Camera focus in normalized canvas coordinates. Time uses the global timeline clock. */
export interface VideoCameraKeyframe {
  timeMs: number;
  zoom?: number;
  x?: number;
  y?: number;
  easing?: AnimationEasing;
  curve?: AnimationCurve;
}
export interface VideoCamera {
  /** 1 is the full scene; up to 4 magnifies footage and device frames beneath labels. */
  zoom: number;
  x: number;
  y: number;
  keyframes?: VideoCameraKeyframe[];
  scaleMode?: "linear" | "perceptual";
  returnMs?: number;
}
export interface VideoPointerEvent {
  timeMs: number; x: number; y: number;
  kind: "move" | "down" | "up";
  screen?: "inner" | "outer";
}
export interface VideoPointerTrack {
  events: VideoPointerEvent[];
  style: "arrow" | "touch";
  color: string; size: number; smoothing: number;
  display: "continuous" | "tap-only";
  idleMs: number; fadeMs: number;
}
export interface VideoAudioTrack {
  id: string; url: string; name: string;
  startMs: number; endMs: number; offsetMs: number;
  volume: number; fadeInMs: number; fadeOutMs: number;
}
export interface VideoAudioFrame { rms: number; peak: number; bass: number; mid: number; treble: number }
export interface VideoAudioAnalysis {
  version: 1; durationMs: number; frameMs: number; frames: VideoAudioFrame[];
  bpm: number; offsetMs: number; confidence: number; beats: number[]; bars: number[];
  drops: number[]; quiet: { startMs: number; endMs: number }[];
}
export interface VideoAudioAnalysisTrack {
  sourceUrl: string; startMs: number; endMs?: number; offsetMs: number; volume: number;
  fadeInMs?: number; fadeOutMs?: number; loop?: boolean; analysis: VideoAudioAnalysis;
}
export interface VideoCodeParameter {
  name: string; kind: "number" | "color" | "text"; value: number | string; min?: number; max?: number;
}
/** Bounded JSON drawing instructions, evaluated without JavaScript or host access. */
export interface VideoCodeClip { source: string; parameters: VideoCodeParameter[] }
export interface VideoGraphic {
  id: string; kind: "shape" | "particles" | "bars" | "ring" | "code";
  startMs: number; endMs: number;
  x: number; y: number; width: number; height: number;
  color: string; seed: number; count: number; speed: number;
  code?: VideoCodeClip;
  audioReactive?: { sourceUrl: string; signal: "envelope" | "bass" | "mid" | "treble"; amount: number };
  animation?: LayerAnimation;
}
export interface VideoExportSettings {
  format: "mp4" | "webm" | "gif" | "png" | "jpeg";
  fps: 24 | 30 | 60;
  resolution: "720p" | "1080p" | "2160p";
  quality: "draft" | "standard" | "high";
}
export interface VideoTimeline {
  version: 1;
  aspectRatio: "9:16" | "4:5" | "1:1" | "16:9";
  background?: {
    color: string;
    endColor?: string;
    /** Static image from the Relay media library, above the color/gradient. */
    imageUrl?: string;
    /** Centered crop or letterbox; defaults to cover. */
    imageFit?: "cover" | "contain";
  };
  camera?: VideoCamera;
  scene?: VideoScene;
  graphics?: VideoGraphic[];
  audioTracks?: VideoAudioTrack[];
  audioAnalysis?: VideoAudioAnalysisTrack[];
  beatGrid?: { bpm: number; offsetMs: number };
  exportSettings?: VideoExportSettings;
  clips: VideoClip[];
  /** Simultaneous overlays above the sequential clips and below timed labels. */
  layers?: VideoLayer[];
  labels: TimedVideoLabel[];
  music: { url: string; name?: string; volume: number; offsetMs: number; fadeInMs: number; fadeOutMs: number; startMs?: number; endMs?: number };
  coverMs: number;
}
export interface VideoRenderJob {
  coverUrl?: string;
  coverMs?: number;
  kind?: "render" | "captions";
  captions?: TimedVideoLabel[];
  id: string;
  projectId: string;
  revision: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  renderedUrl?: string;
  error?: string;
}
