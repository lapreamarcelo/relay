import type { VideoMusicMode, VideoProject } from "@relay/core";

import { normalizeCreativeLabels } from "./creative-labels.ts";

export interface VideoProjectRow {
  id: string;
  brand_id: string | null;
  name: string;
  caption: string;
  source_url: string;
  source_folder_id: string | null;
  music_url: string | null;
  music_folder_id: string | null;
  labels: unknown;
  rendered_url: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export function safeWebUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000) return "";
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""; } catch { return ""; }
}

export function serializeVideoProject(row: VideoProjectRow): VideoProject {
  return {
    id: row.id, brandId: row.brand_id ?? "", name: row.name, caption: row.caption, sourceUrl: row.source_url,
    sourceFolderId: row.source_folder_id ?? undefined, musicUrl: row.music_url ?? undefined, musicFolderId: row.music_folder_id ?? undefined,
    labels: normalizeCreativeLabels(row.labels) ?? [], renderedUrl: row.rendered_url ?? undefined,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function selectMusicTrack(mode: VideoMusicMode, tracks: string[], index: number, fixed?: string, random: () => number = Math.random): string | undefined {
  if (mode === "fixed") return fixed;
  if (!tracks.length || mode === "none") return undefined;
  if (mode === "rotate") return tracks[index % tracks.length];
  return tracks[Math.min(tracks.length - 1, Math.floor(random() * tracks.length))];
}
