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

## Device-framed product demos

1. Run `device-frames list`; use only the returned device choices and configuration fields (including Duo pose and video motion). MCP users can call `list_device_frames`.
2. Choose existing Relay media. Use a one-slide slideshow for an image post, multiple slides for a carousel, or a timeline for video (both image and video clips work).
3. Set `deviceFrame: {"device":"phone","background":"#E8E2D8","color":"#171717"}` on each selected slide/clip. All fields are required and colors are six-digit hex. No frame upload or AI provider key is needed.
4. Prefer `fit: "contain"` when the entire interface must remain visible. `cover` can crop the UI. Catalog layouts describe output pixels; label x/y/width/height remain fractions of the full canvas. Slideshow images use the 9:16 layout.
5. Retrieve before updates, preserve the full document, and pass the video revision. Omit `deviceFrame` to remove it; omit stale `renderedUrl` on edited slides.
6. Render slides with `slideshows render`. For video, use `videos render --id ID --data '{"async":true}'`, then `render-jobs get --id JOB_ID` until completed. Inspect the output before creating drafts or authorized publishing.

Video timeline frames support placement, scale, perspective rotation, gradients, motion presets and entrance/exit effects; Duo supports folding. Discover text/frame keyframes, easing and clip transitions with `capabilities get --query section=video-animation` or MCP `list_video_animations`. Use the catalog bounds, sparse keyframe properties and local-time rules; incoming transitions shorten the timeline by their capped overlap. Authored Duo hinge keyframes override preset folding. Slideshow frames accept static shapes/colors/gradients only; animation requires video timelines. Do not invent mesh assets, separate camera tracks or image/video backgrounds. Legacy video-label recipes and `videos batch` do not apply these frames; use timeline projects and `videos variants` for framed hook variants. Complete payloads are in the Agent API guide's Device frames section.

## Prompt-based video composition

Check `video-composer status` or MCP `get_video_composer`. Use `videos compose --data @request.json` or MCP `generate_video_composition` with `{prompt,timeline,productName?,durationMs?}`. The configured OpenAI service returns an editable preview and warnings; it sends the prompt and bounded recording frames to the provider. Review the preview, then save its timeline with the existing project document and current revision. Generation alone does not save, render, schedule or publish. An agent may instead author the shared timeline directly through `videos update` / `save_video` without invoking the provider. See the Agent API prompt-based composition contract.
