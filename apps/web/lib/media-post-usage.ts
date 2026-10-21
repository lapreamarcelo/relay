export interface MediaPostUsage {
  scheduled: number;
  published: number;
  publishing: number;
}

export type MediaUsageFilter = "all" | "scheduled" | "published" | "publishing" | "none";

export interface MediaUsageRow {
  id: string;
  media_url: string | null;
  media_urls: string[];
  status: string;
  target_status: string | null;
  settings: { kind?: string; coverUrl?: string; thumbnailUrl?: string } | null;
}

export const emptyMediaPostUsage = (): MediaPostUsage => ({ scheduled: 0, published: 0, publishing: 0 });

export function matchesMediaUsage(usage: MediaPostUsage, filter: MediaUsageFilter): boolean {
  return filter === "all" || (filter === "none"
    ? !usage.scheduled && !usage.published && !usage.publishing
    : usage[filter] > 0);
}

/** Count posts, not destinations. A partially published post can occupy two buckets. */
export function indexMediaPostUsage(rows: MediaUsageRow[]): Map<string, MediaPostUsage> {
  const references = new Map<string, Record<keyof MediaPostUsage, Set<string>>>();
  for (const row of rows) {
    const status = row.target_status ?? row.status;
    const bucket = status === "scheduled" || status === "published" ? status
      : status === "publishing" || status === "processing" ? "publishing" : null;
    if (!bucket) continue;
    const urls = [row.media_url, ...row.media_urls];
    if (row.settings?.kind === "instagram") urls.push(row.settings.coverUrl ?? null);
    if (row.settings?.kind === "youtube") urls.push(row.settings.thumbnailUrl ?? null);
    for (const url of urls) {
      if (!url) continue;
      const usage = references.get(url) ?? { scheduled: new Set<string>(), published: new Set<string>(), publishing: new Set<string>() };
      usage[bucket].add(row.id);
      references.set(url, usage);
    }
  }
  return new Map([...references].map(([url, usage]) => [url, {
    scheduled: usage.scheduled.size, published: usage.published.size, publishing: usage.publishing.size,
  }]));
}
