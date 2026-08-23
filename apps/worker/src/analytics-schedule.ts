export function nextAnalyticsDelay(ageMilliseconds: number): number | null {
  if (ageMilliseconds < 6 * 60 * 60_000) return 15 * 60_000;
  if (ageMilliseconds < 48 * 60 * 60_000) return 60 * 60_000;
  if (ageMilliseconds < 7 * 24 * 60 * 60_000) return 6 * 60 * 60_000;
  if (ageMilliseconds < 90 * 24 * 60 * 60_000) return 24 * 60 * 60_000;
  return null;
}
