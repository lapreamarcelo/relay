/** Match the render worker's R2 allowlist before accepting a publishing plan. */
export function youtubeImageMediaError(input: {
  mediaType: string;
  mediaUrl: string | null;
  mediaUrls: string[];
  destinations: Array<{ provider: string }>;
}, publicUrl = process.env.R2_PUBLIC_URL): string | undefined {
  if (input.mediaType !== "image" || !input.destinations.some((target) => target.provider === "youtube")) return;
  const urls = input.mediaUrls.length ? input.mediaUrls : input.mediaUrl ? [input.mediaUrl] : [];
  if (!urls.length || urls[0] !== input.mediaUrl) return "The first YouTube slideshow image must match the post's main image.";
  if (!publicUrl) return "Configure Relay's R2 media library before converting YouTube images to video.";
  try {
    const base = new URL(`${publicUrl.replace(/\/+$/, "")}/`);
    if (!urls.every((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === base.origin && url.pathname.startsWith(base.pathname);
    })) return "Upload YouTube slideshow images to this Relay media library before publishing.";
  } catch { return "Upload YouTube slideshow images to this Relay media library before publishing."; }
}
