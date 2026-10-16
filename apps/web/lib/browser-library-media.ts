/** CORS fallback only; the authenticated endpoint validates the storage origin. */
export function mediaPreviewUrl(sourceUrl: string): string {
  return `/api/v1/media/preview?url=${encodeURIComponent(sourceUrl)}`;
}
