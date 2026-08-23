import type { Brand, ProviderId, ProviderPostSettings, RelayPost, SocialAccount } from "@relay/core";

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

const capturedAt = "2026-08-23T10:42:00.000Z";
const post = (id: string, provider: ProviderId, text: string, views: number, likes: number, comments: number, shares: number, image: number, brandId = "brand-aster"): RelayPost => ({
  id, brandId, text, mediaType: "image", mediaUrl: `/demo/post-${image}.svg`, status: "published", publishedAt: `2026-08-${String(22 - Number(id.slice(-1))).padStart(2, "0")}T12:00:00.000Z`, createdAt: "2026-08-12T12:00:00.000Z",
  targets: [{ id: `target-${id}`, accountId: `account-${provider}`, provider, status: "published", settings: settings[provider], externalUrl: "https://example.com", analytics: { capturedAt, views, reach: Math.round(views * .76), likes, comments, shares, saves: provider === "instagram" ? Math.round(likes * .22) : undefined, averageWatchTimeSeconds: provider === "youtube" || provider === "tiktok" ? 19 : undefined } }],
});

const scheduledPost = (id: string, provider: ProviderId, text: string, scheduledAt: string, image: number, brandId = "brand-aster"): RelayPost => ({
  id, brandId, text, mediaType: "image", mediaUrl: `/demo/post-${image}.svg`, status: "scheduled", scheduledAt, createdAt: "2026-08-23T08:00:00.000Z",
  targets: [{ id: `target-${id}`, accountId: `account-${provider}`, provider, status: "scheduled", settings: settings[provider] }],
});

export const demoPosts: RelayPost[] = [
  scheduledPost("scheduled-1", "instagram", "Tomorrow's studio note: why constraints make the work more memorable.", "2026-08-24T09:30:00.000Z", 2),
  scheduledPost("scheduled-2", "facebook", "A simple content review ritual for small creative teams.", "2026-08-25T14:00:00.000Z", 4, "brand-field"),
  post("post-1", "instagram", "A small ritual for better creative work: leave enough room for the unexpected.", 128400, 11620, 384, 1750, 1),
  post("post-2", "tiktok", "Three decisions that made our launch week feel calm instead of chaotic.", 94200, 8340, 612, 1280, 2),
  post("post-3", "youtube", "The quiet work behind a launch — our complete studio process.", 68100, 4920, 289, 740, 3),
  post("post-4", "facebook", "A field guide to planning content people actually want to save.", 42600, 2100, 184, 512, 4, "brand-field"),
  post("post-5", "instagram", "Build a system that protects the idea, not one that buries it.", 35700, 4310, 126, 620, 2),
  post("post-6", "tiktok", "What our content calendar looks like when nobody is pretending to be a robot.", 28400, 2660, 204, 388, 1),
  post("post-7", "facebook", "Five notes from five years of making things on the internet.", 18300, 940, 76, 225, 3, "brand-field"),
  post("post-8", "youtube", "A practical tour of our publishing workflow.", 12700, 780, 48, 104, 4),
];
