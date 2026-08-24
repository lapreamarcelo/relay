# Relay workflow notes

## Slideshow

1. Discover media with `folders list` and `media list`.
2. Create or update the slideshow recipe. Preserve slide order and use only Relay R2 URLs.
3. Retrieve the project and check every normalized label field.
4. Render with `slideshows render`, or use `slideshows schedule` only after targets and timing are explicit.
5. For a carousel, keep Instagram/Facebook targets on Feed. YouTube cannot receive image slideshows.

## Video

1. Discover source media and licensed music in the correct folder kinds.
2. Create or update the video recipe. Labels use normalized `x`, `y`, `width`, and `height` values.
3. Retrieve the recipe before an expensive render when the agent changed creative fields.
4. Render with `videos render`, or use `videos schedule` after confirming targets and timing.
5. Use `videos batch` for hook variants. With no `accountIds`, it renders without posting; with accounts it can cause multiple external posts.

## Posts and bulk operations

- Discover account IDs immediately before building targets.
- Match each target's `settings.kind` to that account's provider.
- Use a timezone-qualified ISO timestamp for scheduling.
- Bulk create accepts up to 100 posts, slideshow bulk create up to 50 projects, and video hook batch up to 20 hooks.
- On HTTP 207, collect failures by index and retry only those entries with their original idempotency keys.

## Analytics

Pass explicit `from` and `to` ISO timestamps to `analytics report`. Add brand, account, campaign, provider, or media filters only when needed. Preserve unavailable metrics as `null`; do not present them as zero.
