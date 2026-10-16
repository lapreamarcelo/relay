export type AssetKind = "media" | "music";

export function unfiledMediaPrefix(ownerId: string, kind: AssetKind): string {
  return `media-owners/${encodeURIComponent(ownerId)}/${kind}/`;
}

/** Old root keys carry no ownership evidence. Only an operator's explicit
 * assignment can grant access; registration order/user count is not evidence. */
export function ownsLegacyMedia(ownerId: string): boolean {
  const configuredOwner = process.env.RELAY_LEGACY_MEDIA_OWNER_ID?.trim();
  return Boolean(configuredOwner && configuredOwner === ownerId);
}

export function mediaObjectLocation(key: string): {
  kind: AssetKind;
  projectId: string | null;
  ownerSegment: string | null;
} | null {
  const project = /^media-projects\/([0-9a-f-]{36})\/(media|music)\/[^/]+$/i.exec(key);
  if (project) return { kind: project[2].toLowerCase() as AssetKind, projectId: project[1], ownerSegment: null };
  const owned = /^media-owners\/([^/]+)\/(media|music)\/[^/]+$/.exec(key);
  if (owned) return { kind: owned[2] as AssetKind, projectId: null, ownerSegment: owned[1] };
  const legacy = /^(media|music)\/[^/]+$/.exec(key);
  return legacy ? { kind: legacy[1] as AssetKind, projectId: null, ownerSegment: null } : null;
}

export function ownsUnfiledMedia(key: string, ownerId: string, kind?: AssetKind): boolean {
  const location = mediaObjectLocation(key);
  if (!location || location.projectId || kind && location.kind !== kind) return false;
  return location.ownerSegment === null ? ownsLegacyMedia(ownerId) : location.ownerSegment === encodeURIComponent(ownerId);
}
