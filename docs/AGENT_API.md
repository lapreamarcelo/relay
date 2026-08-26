# Relay agent API

Relay exposes a small REST API for trusted agents and automations. The API uses the same validation, database, and publishing worker as the dashboard.

## Create a key

Sign in to Relay, open **Settings → API keys**, and create a key. Relay shows the secret once. Send it with every request:

```http
Authorization: Bearer relay_sk_...
Content-Type: application/json
```

Agent keys can manage brands, publishing defaults, media, creative projects, analytics, and posts. They cannot manage users, API keys, provider credentials, OAuth connections, or connected-account deletion.

Set these values in the agent environment rather than its prompt:

```env
RELAY_URL=https://relay.example.com
RELAY_API_KEY=relay_sk_...
```

Use the first-party [Relay CLI](CLI.md) for agent and shell workflows. It provides stable JSON commands for the complete API, direct media uploads, and render-then-schedule helpers. The curl examples below document the underlying REST contract; the MCP adapter remains optional for clients that specifically require MCP.

## Discover destination IDs

```bash
curl "$RELAY_URL/api/v1/accounts" \
  -H "Authorization: Bearer $RELAY_API_KEY"

curl "$RELAY_URL/api/v1/brands" \
  -H "Authorization: Bearer $RELAY_API_KEY"
```

Only connected-account IDs returned by Relay can be used as `accountId` values.

## List posts

```bash
curl "$RELAY_URL/api/v1/posts" \
  -H "Authorization: Bearer $RELAY_API_KEY"
```

## Read post analytics

Retrieve the timestamped metric history for one post. Results are grouped by destination, allowing an agent to compare platforms without losing provider-specific raw metrics.

```bash
curl "$RELAY_URL/api/v1/analytics?postId=post-id" \
  -H "Authorization: Bearer $RELAY_API_KEY"
```

This endpoint requires the `posts:read` scope and returns only posts owned by the key's workspace.

## Create one post

Use `status: "publishing"` to publish as soon as the worker can claim it, `status: "scheduled"` with `scheduledAt` for a future post, or `status: "draft"` to save it without publishing.

Always give an automated request a stable `clientRequestId`. Retrying the same request ID returns the original post instead of creating a duplicate.

```bash
curl -X POST "$RELAY_URL/api/v1/posts" \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "clientRequestId": "campaign-42-instagram-2026-09-01",
    "brandId": "optional-brand-id",
    "campaignId": "optional-campaign-id",
    "text": "The post caption",
    "mediaType": "image",
    "mediaUrl": "https://media.example.com/posts/launch.jpg",
    "status": "scheduled",
    "scheduledAt": "2026-09-01T10:00:00Z",
    "targets": [{
      "accountId": "connected-account-id",
      "settings": { "kind": "instagram", "publishType": "feed" },
      "textOverride": "Optional Instagram-specific caption"
    }]
  }'
```

`mediaType` is `none`, `image`, or `video`. A public HTTPS `mediaUrl` is required for image and video posts. Uploading new agent-provided files is intentionally outside this first API version; use an existing object from Relay's R2 media library.

For an image slideshow, keep `mediaType: "image"`, set `mediaUrl` to the first rendered slide (the cover), and send every ordered slide in `mediaUrls`. Relay preserves that order when publishing Instagram carousels, Facebook multi-photo posts, and TikTok photo posts. Instagram accepts up to 10 slides; Relay accepts up to 35 for Facebook and TikTok. YouTube destinations require video and are rejected for image posts.

```json
{
  "text": "A five-slide photo story",
  "mediaType": "image",
  "mediaUrl": "https://media.example.com/slideshows/project/slide-1.png",
  "mediaUrls": [
    "https://media.example.com/slideshows/project/slide-1.png",
    "https://media.example.com/slideshows/project/slide-2.png"
  ],
  "status": "scheduled",
  "scheduledAt": "2026-09-01T10:00:00Z",
  "targets": [{
    "accountId": "connected-tiktok-account-id",
    "settings": { "kind": "tiktok", "privacyLevel": "SELF_ONLY", "allowComments": false, "allowDuet": false, "allowStitch": false }
  }]
}
```

## Slideshow projects and media

List the existing R2 media that an agent can select:

```bash
curl "$RELAY_URL/api/v1/media?limit=100" \
  -H "Authorization: Bearer $RELAY_API_KEY"
```

Create a reusable project with ordered images and optional text per slide. A slide without `text` remains image-only.

```bash
curl -X POST "$RELAY_URL/api/v1/slideshows" \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Launch story",
    "brandId": "optional-brand-id",
    "caption": "The post caption",
    "slides": [
      { "id": "cover", "mediaUrl": "https://media.example.com/media/cover.jpg", "text": "A title", "fit": "cover", "textPosition": "bottom", "textX": 0.5, "textY": 0.78, "textWidth": 0.87, "textHeight": 0.12, "textSize": 64, "textFont": "modern", "textColor": "#FFFFFF", "textBackground": "dark", "textBackgroundColor": "#000000" },
      { "id": "detail", "mediaUrl": "https://media.example.com/media/detail.jpg", "fit": "cover", "textPosition": "bottom", "textWidth": 0.87, "textHeight": 0.12, "textSize": 64, "textFont": "modern", "textColor": "#FFFFFF", "textBackground": "dark", "textBackgroundColor": "#000000" }
    ]
  }'
```

Use `GET /api/v1/slideshows`, `GET /api/v1/slideshows?id=...`, `PATCH /api/v1/slideshows`, and `DELETE /api/v1/slideshows` to list, retrieve, update, and delete projects. Send `{ "projects": [...] }` to `POST /api/v1/slideshows` to bulk-create up to 50 projects.

Render a saved project before scheduling it:

```bash
curl -X POST "$RELAY_URL/api/v1/slideshows/render" \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "id": "slideshow-project-id" }'
```

Rendering creates a new named Media folder and stores one numbered 1080×1920 JPEG per slide in order. The response returns the folder plus each URL as `renderedUrl`. Project instructions live in PostgreSQL; rendered R2 images are immutable publishing artifacts. Schedule them through `/api/v1/posts` using the ordered `renderedUrl` values in `mediaUrls`. Instagram accepts up to 10 slides; Facebook and TikTok use the same ordered list. YouTube cannot be selected because it requires video.

### Platform settings

Each target needs settings matching its connected provider:

```json
{ "kind": "instagram", "publishType": "feed" }
{ "kind": "facebook", "publishType": "feed", "linkUrl": "https://example.com" }
{ "kind": "tiktok", "privacyLevel": "SELF_ONLY", "allowComments": false, "allowDuet": false, "allowStitch": false }
{ "kind": "youtube", "title": "Video title", "tags": ["relay"], "privacyStatus": "private", "madeForKids": false, "thumbnailUrl": "https://media.example.com/thumbnail.jpg" }
```

Instagram `publishType` supports `feed`, `reel`, or `story`. For an Instagram Reel, set either `coverUrl` to a public HTTPS JPEG or `thumbOffsetMs` to a frame position in milliseconds; `coverUrl` takes precedence. TikTok Direct Posts accept `thumbOffsetMs` for the video cover frame. Facebook supports `feed` or `reel`, but Meta's Reel publishing endpoint does not accept a cover. YouTube privacy supports `private`, `unlisted`, or `public`; `thumbnailUrl` may be a public HTTPS JPEG or PNG no larger than 2 MB. TikTok `SELF_ONLY` sends media to the creator's TikTok inbox for manual review and publishing; visibility, interactions, and the cover are chosen in TikTok. Other TikTok privacy levels use Direct Post and are validated against the creator's current capabilities at publish time.

Relay validates media requirements and caption limits before saving. YouTube requires video, TikTok requires media, and Reel or Story settings may require a specific media type. `textOverride` stores a destination-specific caption; omit it to use the post's shared `text`.

### Publishing defaults

`GET /api/v1/settings/publishing` returns the workspace owner's normalized Instagram image/video formats, Facebook video format, TikTok privacy/interactions, and YouTube privacy/audience defaults. `PUT /api/v1/settings/publishing` replaces them. These endpoints require `settings:read` and `settings:write`; Settings-generated keys include both.

Defaults are starting values for new composer and batch workflows. Explicit settings saved in a post or template remain authoritative.

## Campaigns and templates

Use `GET /api/v1/campaigns` to list campaign IDs. Create one with a name, optional brand, and optional color:

```bash
curl -X POST "$RELAY_URL/api/v1/campaigns" \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "September launch", "brandId": "brand-id", "color": "#ff5c35" }'
```

`PATCH /api/v1/campaigns` updates a campaign's name, color, and `active`/`archived` status. `DELETE /api/v1/campaigns` removes the group while preserving its posts.

Use `GET /api/v1/templates` and `POST /api/v1/templates` for reusable base copy and per-provider settings. Templates are starting points and never mutate posts already created from them.

## Create up to 100 posts

Send the same post objects inside `posts`. Each item should have its own `clientRequestId`.

```bash
curl -X POST "$RELAY_URL/api/v1/posts" \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "posts": [ ... ] }'
```

The response contains an indexed result for every item and a `summary`. HTTP `201` means every post was created; `207` means at least one item failed validation. Valid items are still created when another item fails.

## Reschedule or publish now

Only drafts and scheduled posts can be changed this way.

```bash
curl -X PATCH "$RELAY_URL/api/v1/posts" \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "id": "post-id", "scheduledAt": "2026-09-02T15:30:00Z" }'
```

Set `scheduledAt` to `null` to hand the post to the publishing worker immediately.

Bulk-reschedule up to 100 drafts or scheduled posts atomically:

```json
{
  "updates": [
    { "id": "post-id-1", "scheduledAt": "2026-09-03T10:00:00Z" },
    { "id": "post-id-2", "scheduledAt": "2026-09-04T10:00:00Z" }
  ]
}
```

To edit all mutable content on an existing draft or scheduled post, send its complete post object to `PATCH /api/v1/posts`. Captions, destinations, per-network variants, settings, media, brand, campaign, status, and schedule may change until publishing begins.

Retry only failed destinations without republishing successful ones:

```json
{ "id": "post-id", "retryTargetIds": ["failed-target-id"] }
```

## Delete or cancel posts

Delete one post with `id`, or up to 100 with `ids`:

```bash
curl -X DELETE "$RELAY_URL/api/v1/posts" \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["post-id-1", "post-id-2"] }'
```

Deletion is all-or-nothing. Relay refuses the request if any post does not belong to the key owner or has already entered provider publishing/processing.

## Optional MCP adapter

Relay includes a runnable stdio adapter in `apps/mcp`. Configure it in an MCP client with the Relay origin and an API key:

```json
{
  "mcpServers": {
    "relay": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/relay", "--filter", "@relay/mcp", "start"],
      "env": {
        "RELAY_URL": "https://relay.example.com",
        "RELAY_API_KEY": "relay_sk_..."
      }
    }
  }
}
```

The adapter exposes `list_destinations`, `list_media`, `list_asset_folders`, `create_asset_folder`, `list_slideshows`, `save_slideshow`, `create_slideshows`, `render_slideshow`, `schedule_slideshow`, `create_slideshow_batch`, `list_videos`, `save_video`, `render_video`, `schedule_video`, `create_video_batch`, `analytics_report`, and `schedule_analytics_report`. It remains a thin client: PostgreSQL ownership checks, R2 rendering, idempotency, scheduling, and publishing stay in Relay's REST API.

## Asset folders and music

`GET /api/v1/media/projects` lists every named R2 folder. Add `?kind=media` or `?kind=music` to narrow the result. Create a folder with:

```json
{ "name": "Product launch", "kind": "media" }
```

Rename a folder with `PATCH /api/v1/media/projects` and `{ "id": "...", "name": "New name" }`. Folder IDs and object URLs remain stable.

Rename an object with `PATCH /api/v1/media` and `{ "key": "...", "name": "new-name.mp4" }`. Move it between folders with `{ "key": "...", "projectId": "destination-folder-id", "kind": "media" }`; use `"unfiled"` as the destination for the general Media or Music area. Relay copies the R2 object, updates owned post and creative-project references to its new public URL, and then deletes the old key.

Use `kind=music` for licensed audio libraries. `GET /api/v1/media?kind=music&project=<folder-id>` returns the tracks agents may assign to videos. Upload signing and fallback uploads accept `kind`, and audio files are accepted only for music folders.

## Video label recipes

`POST /api/v1/videos` creates an editable recipe. `PATCH /api/v1/videos` updates it, `GET /api/v1/videos` lists recipes, and `GET /api/v1/videos?id=...` retrieves one. Labels use normalized `x` and `y` canvas coordinates, a normalized `width`, `fontSize`, and one of three shortcut styles:

```json
{
  "name": "Launch hook",
  "sourceUrl": "https://media.example.com/media-projects/folder/media/clip.mp4",
  "musicUrl": "https://media.example.com/media-projects/music-folder/music/theme.mp3",
  "labels": [{
    "text": "The mistake nobody notices",
    "x": 0.5,
    "y": 0.18,
    "width": 0.84,
    "fontSize": 72,
    "style": "dark",
    "textColor": "#FFFFFF",
    "background": "dark",
    "backgroundColor": "#000000"
  }]
}
```

`POST /api/v1/videos/render` with `{ "id": "..." }` creates an immutable 1080×1920 H.264 MP4 in a new named R2 Media folder. The renderer fits the source to 9:16, draws every label, mixes selected R2 music with source audio, and limits inputs to five minutes. In the app, **Create post** performs this render and opens the shared composer so the user can select several accounts, platform-specific options, and publish timing.

Video labels accept `font: "modern" | "editorial" | "mono"`; slideshow labels use the equivalent `textFont` field. Both support manual foreground/background colors, font sizes from 28–160, widths from 0.25–0.92, and heights from 0.06–0.35 of the 9:16 canvas. Relay bundles matching DejaVu Sans, Serif, and Sans Mono faces so browser previews and rendered assets stay consistent.

## Bulk hook videos

`POST /api/v1/videos/batch` accepts up to 20 hooks. It replaces the recipe's first label for each hook, renders every version into one new ordered Media folder, and optionally schedules every result to one or more connected accounts.

```json
{
  "projectId": "video-project-id",
  "hooks": ["Hook one", "Hook two", "Hook three"],
  "musicMode": "random",
  "musicFolderId": "music-folder-id",
  "accountIds": ["instagram-account-id", "tiktok-account-id"],
  "scheduledAt": "2026-09-01T09:00:00.000Z",
  "intervalMinutes": 1440,
  "captionTemplate": "{hook} #launch",
  "clientRequestId": "launch-batch-v1"
}
```

`musicMode` is `none`, `fixed`, `rotate`, or `random`. With no `accountIds`, Relay renders the batch to R2 without scheduling it. A `207` response reports partial failures per hook without hiding successful renders.

## Historical analytics

`GET /api/v1/analytics?from=<ISO>&to=<ISO>` returns period deltas, prior-period growth, daily series, metric availability, and content rankings. Optional filters are `brandId`, `accountId`, `campaignId`, `provider`, and `mediaType`. Add `format=csv` for a downloadable report. Relay keeps unavailable provider metrics as `null` instead of implying zero.

`GET /api/v1/analytics/reports` lists scheduled reports. `POST /api/v1/analytics/reports` accepts `{ "name": "Weekly growth", "cadence": "weekly", "filters": { "days": 7, "brandId": "..." } }`. `DELETE` accepts `{ "id": "..." }`. The worker creates an in-app notification with a fresh CSV link at each due time.
