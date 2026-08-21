import type { ProviderId } from "@relay/core";

export interface ProviderManifest {
  id: ProviderId;
  name: string;
  shortName: string;
  color: string;
  capabilities: { text: boolean; images: boolean; video: boolean; maxCaption: number };
}

const manifests: ProviderManifest[] = [
  { id: "instagram", name: "Instagram", shortName: "IG", color: "#d9468f", capabilities: { text: true, images: true, video: true, maxCaption: 2200 } },
  { id: "facebook", name: "Facebook", shortName: "f", color: "#1877f2", capabilities: { text: true, images: true, video: true, maxCaption: 63206 } },
  { id: "tiktok", name: "TikTok", shortName: "TK", color: "#111111", capabilities: { text: true, images: true, video: true, maxCaption: 2200 } },
  { id: "youtube", name: "YouTube", shortName: "YT", color: "#ff0033", capabilities: { text: true, images: false, video: true, maxCaption: 5000 } },
];

export class ProviderRegistry {
  private providers = new Map<ProviderId, ProviderManifest>();
  constructor(items: ProviderManifest[]) { items.forEach((item) => this.providers.set(item.id, item)); }
  get(id: ProviderId) { const provider = this.providers.get(id); if (!provider) throw new Error(`Unknown provider: ${id}`); return provider; }
  list() { return [...this.providers.values()]; }
}

export const providerRegistry = new ProviderRegistry(manifests);
