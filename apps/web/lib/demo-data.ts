import type {
  Brand,
  Campaign,
  PostTemplate,
  ProviderId,
  ProviderPostSettings,
  RelayPost,
  SlideshowProject,
  SocialAccount,
  VideoProject,
} from "@relay/core";

export const demoBrands: Brand[] = [
  { id: "brand-aster", name: "Aster Studio", monogram: "AS", color: "#ff5c35", timezone: "Europe/Madrid" },
  { id: "brand-field", name: "Field Notes", monogram: "FN", color: "#3f72df", timezone: "Europe/Madrid" },
];

const account = (id: string, provider: ProviderId, displayName: string, handle: string, brandId: string): SocialAccount => ({ id, provider, displayName, handle, brandId, authMethod: provider === "instagram" ? "instagram-standalone" : provider, providerAccountId: `${provider}-demo`, status: "connected", followers: "" });

export const demoAccounts: SocialAccount[] = [
  account("account-instagram", "instagram", "Aster Studio", "@aster.studio", "brand-aster"),
  account("account-tiktok", "tiktok", "Aster Studio", "@asterstudio", "brand-aster"),
  account("account-youtube", "youtube", "Aster Studio", "@asterstudio", "brand-aster"),
  account("account-facebook", "facebook", "Field Notes", "@fieldnotes", "brand-field"),
];

const settings: Record<ProviderId, ProviderPostSettings> = {
  instagram: { kind: "instagram", publishType: "reel" },
  facebook: { kind: "facebook", publishType: "feed" },
  tiktok: { kind: "tiktok", privacyLevel: "PUBLIC_TO_EVERYONE", allowComments: true, allowDuet: false, allowStitch: false },
  youtube: { kind: "youtube", title: "The quiet work behind a launch", tags: ["design", "studio"], privacyStatus: "public", madeForKids: false },
};

export const demoCampaigns: Campaign[] = [
  { id: "campaign-studio-launch", brandId: "brand-aster", name: "Studio launch", color: "#ff5c35", status: "active", postCount: 5, createdAt: "2026-08-01T09:00:00.000Z", updatedAt: "2026-08-22T14:30:00.000Z" },
  { id: "campaign-field-guide", brandId: "brand-field", name: "Field guide series", color: "#3f72df", status: "active", postCount: 3, createdAt: "2026-07-28T09:00:00.000Z", updatedAt: "2026-08-21T11:00:00.000Z" },
  { id: "campaign-evergreen", brandId: "", name: "Evergreen ideas", color: "#6b7280", status: "active", postCount: 4, createdAt: "2026-07-15T09:00:00.000Z", updatedAt: "2026-08-20T16:00:00.000Z" },
];

const capturedAt = "2026-08-23T10:42:00.000Z";
const post = (id: string, provider: ProviderId, text: string, views: number, likes: number, comments: number, shares: number, image: number, brandId = "brand-aster", campaignId?: string, campaignName?: string): RelayPost => ({
  id, brandId, campaignId, campaignName, text, mediaType: "image", mediaUrl: `/demo/post-${image}.svg`, status: "published", publishedAt: `2026-08-${String(22 - Number(id.slice(-1))).padStart(2, "0")}T12:00:00.000Z`, createdAt: "2026-08-12T12:00:00.000Z",
  targets: [{ id: `target-${id}`, accountId: `account-${provider}`, provider, status: "published", settings: settings[provider], externalUrl: "https://example.com", analytics: { capturedAt, views, reach: Math.round(views * .76), likes, comments, shares, saves: provider === "instagram" ? Math.round(likes * .22) : undefined, averageWatchTimeSeconds: provider === "youtube" || provider === "tiktok" ? 19 : undefined } }],
});

const scheduledPost = (id: string, provider: ProviderId, text: string, scheduledAt: string, image: number, brandId = "brand-aster"): RelayPost => ({
  id, brandId, text, mediaType: "image", mediaUrl: `/demo/post-${image}.svg`, status: "scheduled", scheduledAt, createdAt: "2026-08-23T08:00:00.000Z",
  targets: [{ id: `target-${id}`, accountId: `account-${provider}`, provider, status: "scheduled", settings: settings[provider] }],
});

export const demoPosts: RelayPost[] = [
  scheduledPost("scheduled-1", "instagram", "Tomorrow's studio note: why constraints make the work more memorable.", "2026-08-24T09:30:00.000Z", 2),
  scheduledPost("scheduled-2", "facebook", "A simple content review ritual for small creative teams.", "2026-08-25T14:00:00.000Z", 4, "brand-field"),
  post("post-1", "instagram", "A small ritual for better creative work: leave enough room for the unexpected.", 128400, 11620, 384, 1750, 1, "brand-aster", "campaign-studio-launch", "Studio launch"),
  post("post-2", "tiktok", "Three decisions that made our launch week feel calm instead of chaotic.", 94200, 8340, 612, 1280, 2, "brand-aster", "campaign-studio-launch", "Studio launch"),
  post("post-3", "youtube", "The quiet work behind a launch — our complete studio process.", 68100, 4920, 289, 740, 3, "brand-aster", "campaign-studio-launch", "Studio launch"),
  post("post-4", "facebook", "A field guide to planning content people actually want to save.", 42600, 2100, 184, 512, 4, "brand-field", "campaign-field-guide", "Field guide series"),
  post("post-5", "instagram", "Build a system that protects the idea, not one that buries it.", 35700, 4310, 126, 620, 2, "brand-aster", "campaign-evergreen", "Evergreen ideas"),
  post("post-6", "tiktok", "What our content calendar looks like when nobody is pretending to be a robot.", 28400, 2660, 204, 388, 1, "brand-aster", "campaign-evergreen", "Evergreen ideas"),
  post("post-7", "facebook", "Five notes from five years of making things on the internet.", 18300, 940, 76, 225, 3, "brand-field", "campaign-field-guide", "Field guide series"),
  post("post-8", "youtube", "A practical tour of our publishing workflow.", 12700, 780, 48, 104, 4, "brand-aster", "campaign-evergreen", "Evergreen ideas"),
];

export type DemoAnalyticsMetric = "views" | "reach" | "likes" | "comments" | "shares" | "saves" | "watchTimeSeconds";
export interface DemoAnalyticsData {
  range: { from: string; to: string };
  summary: Record<DemoAnalyticsMetric, number | null>;
  growth: Record<DemoAnalyticsMetric, number | null>;
  available: DemoAnalyticsMetric[];
  series: Array<{ date: string } & Record<DemoAnalyticsMetric, number | null>>;
  ranking: Array<{ postId: string; targetId: string; provider: ProviderId; caption: string; mediaType: string; values: Record<DemoAnalyticsMetric, number | null> }>;
  sample: { snapshots: number; destinations: number };
}

const demoAnalyticsRanking = demoPosts.filter((postItem) => postItem.status === "published").flatMap((postItem) => postItem.targets.map((target) => {
  const analytics = target.analytics;
  const views = analytics?.views ?? 0;
  return {
    postId: postItem.id,
    targetId: target.id,
    provider: target.provider,
    caption: postItem.text,
    mediaType: postItem.mediaType,
    values: {
      views: analytics?.views ?? null,
      reach: analytics?.reach ?? null,
      likes: analytics?.likes ?? null,
      comments: analytics?.comments ?? null,
      shares: analytics?.shares ?? null,
      saves: analytics?.saves ?? null,
      watchTimeSeconds: analytics?.averageWatchTimeSeconds ? Math.round(analytics.averageWatchTimeSeconds * views * .28) : null,
    },
  };
})).sort((a, b) => (b.values.views ?? 0) - (a.values.views ?? 0));

export const demoAnalytics: DemoAnalyticsData = {
  range: { from: "2026-08-18T00:00:00.000Z", to: "2026-08-24T23:59:59.000Z" },
  summary: { views: 408400, reach: 310384, likes: 35670, comments: 1923, shares: 5624, saves: 3350, watchTimeSeconds: 1268400 },
  growth: { views: 18.6, reach: 14.2, likes: 22.8, comments: 9.4, shares: 31.1, saves: 27.5, watchTimeSeconds: 16.9 },
  available: ["views", "reach", "likes", "comments", "shares", "saves", "watchTimeSeconds"],
  series: [
    { date: "2026-08-18", views: 31800, reach: 24200, likes: 2740, comments: 138, shares: 410, saves: 218, watchTimeSeconds: 104600 },
    { date: "2026-08-19", views: 42600, reach: 31900, likes: 3460, comments: 175, shares: 560, saves: 302, watchTimeSeconds: 128400 },
    { date: "2026-08-20", views: 51700, reach: 39100, likes: 4420, comments: 214, shares: 680, saves: 408, watchTimeSeconds: 154900 },
    { date: "2026-08-21", views: 62400, reach: 47200, likes: 5380, comments: 263, shares: 804, saves: 492, watchTimeSeconds: 192300 },
    { date: "2026-08-22", views: 78100, reach: 59300, likes: 6940, comments: 354, shares: 1030, saves: 640, watchTimeSeconds: 249800 },
    { date: "2026-08-23", views: 111800, reach: 84684, likes: 12730, comments: 779, shares: 2140, saves: 1290, watchTimeSeconds: 438400 },
  ],
  ranking: demoAnalyticsRanking,
  sample: { snapshots: 48, destinations: 4 },
};

export const demoTemplates: PostTemplate[] = [
  { id: "template-launch-recap", brandId: "brand-aster", name: "Launch recap", text: "What changed when we gave the idea more room to breathe?\n\nHere are the three choices that made this launch feel lighter.", mediaType: "image", settings, createdAt: "2026-08-02T10:00:00.000Z", updatedAt: "2026-08-22T10:00:00.000Z" },
  { id: "template-field-note", brandId: "brand-field", name: "Field note", text: "A field note for small teams:\n\nThe system should protect the work, not bury it.", mediaType: "image", settings: { facebook: settings.facebook, instagram: settings.instagram }, createdAt: "2026-07-30T10:00:00.000Z", updatedAt: "2026-08-18T10:00:00.000Z" },
];

export interface DemoMediaObject { key: string; name: string; size: number; lastModified: string; etag: string; url: string }
export interface DemoMediaProject { id: string; name: string; kind: "media" | "music"; count: number; createdAt: string }

const demoMediaProjectId = "33333333-3333-4333-8333-333333333333";
const demoMusicProjectId = "44444444-4444-4444-8444-444444444444";

export const demoMediaProjects: DemoMediaProject[] = [
  { id: demoMediaProjectId, name: "Aster launch assets", kind: "media", count: 4, createdAt: "2026-08-01T10:00:00.000Z" },
  { id: demoMusicProjectId, name: "Launch music", kind: "music", count: 2, createdAt: "2026-08-03T10:00:00.000Z" },
];

export const demoMedia: DemoMediaObject[] = [
  { key: `media-projects/${demoMediaProjectId}/media/post-1.svg`, name: "aster-ritual.svg", size: 184320, lastModified: "2026-08-22T10:00:00.000Z", etag: "demo-aster-ritual", url: "/demo/post-1.svg" },
  { key: `media-projects/${demoMediaProjectId}/media/post-2.svg`, name: "launch-decisions.svg", size: 212992, lastModified: "2026-08-21T10:00:00.000Z", etag: "demo-launch-decisions", url: "/demo/post-2.svg" },
  { key: `media-projects/${demoMediaProjectId}/media/post-3.svg`, name: "studio-process.svg", size: 245760, lastModified: "2026-08-20T10:00:00.000Z", etag: "demo-studio-process", url: "/demo/post-3.svg" },
  { key: `media-projects/${demoMediaProjectId}/media/post-4.svg`, name: "field-guide.svg", size: 196608, lastModified: "2026-08-19T10:00:00.000Z", etag: "demo-field-guide", url: "/demo/post-4.svg" },
];

export const demoMusic: DemoMediaObject[] = [
  { key: `media-projects/${demoMusicProjectId}/music/soft-launch.mp3`, name: "soft-launch.mp3", size: 3840000, lastModified: "2026-08-18T10:00:00.000Z", etag: "demo-soft-launch", url: "/demo/post-1.svg" },
  { key: `media-projects/${demoMusicProjectId}/music/late-afternoon.mp3`, name: "late-afternoon.mp3", size: 5120000, lastModified: "2026-08-16T10:00:00.000Z", etag: "demo-late-afternoon", url: "/demo/post-2.svg" },
];

const demoSlide = (id: string, mediaUrl: string, text: string): SlideshowProject["slides"][number] => ({ id, mediaUrl, text, fit: "cover", textPosition: "bottom", textX: .5, textY: .78, textWidth: .87, textHeight: .12, textSize: 64, textFont: "modern", textColor: "#FFFFFF", textBackground: "dark", textBackgroundColor: "#000000" });

export const demoSlideshowProjects: SlideshowProject[] = [
  { id: "slideshow-launch-story", brandId: "brand-aster", name: "Launch story", caption: "The quiet work behind a launch.", slides: [demoSlide("launch-slide-1", "/demo/post-1.svg", "Make room for the unexpected"), demoSlide("launch-slide-2", "/demo/post-2.svg", "Three choices that changed the week"), demoSlide("launch-slide-3", "/demo/post-3.svg", "Build a system around the idea")], createdAt: "2026-08-10T10:00:00.000Z", updatedAt: "2026-08-23T10:00:00.000Z" },
  { id: "slideshow-field-notes", brandId: "brand-field", name: "Field notes carousel", caption: "A field guide for small creative teams.", slides: [demoSlide("field-slide-1", "/demo/post-4.svg", "A calmer content review ritual"), demoSlide("field-slide-2", "/demo/post-1.svg", "Keep the idea visible")], createdAt: "2026-08-06T10:00:00.000Z", updatedAt: "2026-08-21T10:00:00.000Z" },
];

export const demoVideoProjects: VideoProject[] = [
  { id: "video-launch-hooks", brandId: "brand-aster", name: "Launch hooks", caption: "{hook}", sourceUrl: "", sourceFolderId: demoMediaProjectId, musicFolderId: demoMusicProjectId, labels: [{ id: "launch-hook-label", text: "Your hook goes here", x: .5, y: .18, width: .84, height: .12, fontSize: 72, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark" }], createdAt: "2026-08-11T10:00:00.000Z", updatedAt: "2026-08-23T10:00:00.000Z" },
  { id: "video-field-walkthrough", brandId: "brand-field", name: "Field guide walkthrough", caption: "A practical note for the next planning session.", sourceUrl: "", sourceFolderId: demoMediaProjectId, labels: [{ id: "field-guide-label", text: "Try this before your next post", x: .5, y: .18, width: .84, height: .12, fontSize: 68, font: "editorial", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark" }], createdAt: "2026-08-08T10:00:00.000Z", updatedAt: "2026-08-20T10:00:00.000Z" },
];

export interface DemoReport { id: string; name: string; cadence: "weekly" | "monthly"; nextRunAt: string; lastSentAt: string | null }

export const demoReports: DemoReport[] = [
  { id: "demo-report-weekly", name: "Weekly channel recap", cadence: "weekly", nextRunAt: "2026-08-30T08:00:00.000Z", lastSentAt: "2026-08-23T08:00:00.000Z" },
];

export interface DemoNotification {
  id: string;
  eventKey: string;
  postId: string | null;
  targetId: string | null;
  provider: ProviderId | null;
  kind: "success" | "error" | "scheduled" | "info";
  title: string;
  message: string;
  externalUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export const demoNotifications: DemoNotification[] = [
  { id: "demo-notification-1", eventKey: "post-1:target-post-1:published", postId: "post-1", targetId: "target-post-1", provider: "instagram", kind: "success", title: "Post published on Instagram", message: "Aster Studio (@aster.studio) returned a successful publishing result.", externalUrl: "https://example.com", readAt: null, createdAt: "2026-08-23T12:04:00.000Z" },
  { id: "demo-notification-2", eventKey: "scheduled-1:target-scheduled-1:scheduled", postId: "scheduled-1", targetId: "target-scheduled-1", provider: "instagram", kind: "scheduled", title: "Instagram post scheduled", message: "Scheduled for Aug 24, 2026, 9:30 AM on Aster Studio (@aster.studio).", externalUrl: null, readAt: null, createdAt: "2026-08-23T08:00:00.000Z" },
  { id: "demo-notification-3", eventKey: "post-4:target-post-4:published", postId: "post-4", targetId: "target-post-4", provider: "facebook", kind: "success", title: "Post published on Facebook", message: "Field Notes (@fieldnotes) returned a successful publishing result.", externalUrl: "https://example.com", readAt: "2026-08-23T12:30:00.000Z", createdAt: "2026-08-19T12:04:00.000Z" },
];
