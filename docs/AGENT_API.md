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

Use `status`, `mediaType`, `accountId`, `from`, and `to` query parameters to filter the result. Date filters use the post's scheduled, published, or created timestamp, in that order.

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

`mediaType` is `none`, `image`, or `video`. A public HTTPS `mediaUrl` is required for image and video posts. The CLI and local MCP adapter can upload agent-provided files through Relay's short-lived signed R2 upload flow.

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

The adapter exposes the complete agent-safe Relay surface: destination and provider discovery; filtered post listing and full post lifecycle actions; media upload, organization, deletion, and Pexels import; asset-folder management; slideshow and video CRUD/render/scheduling workflows; analytics and scheduled reports; brands, campaigns, templates, publishing defaults, notifications, and health checks.

### Editable app demos through MCP

The video editor and MCP use the same timeline document. Device pose/motion, Duo folding, canvas gradients, animated text and frames, clip transitions, trims/crops/volume, music ranges/fades and cover time are all available through `save_video`.

1. Call `get_capabilities`, `list_device_frames` and `list_video_animations` to discover the current controls, examples and limits.
2. Choose footage with `list_media`. Local stdio clients can use `upload_media`; remote clients use `prepare_media_upload` and PUT their bytes to the returned signed URL.
3. Create with `save_video`, supplying the timeline. For an existing project, call `list_videos` with its `id`, edit the returned `data`, and pass the full document and retrieved `revision` to `save_video`. Preserve other clips, labels and audio. Empty legacy `sourceUrl`/`musicUrl` fields are accepted for timeline projects. A revision conflict requires retrieving the latest document and merging edits.
4. Call `save_video_template` to reuse the composition, or `create_video_variants` for 1–20 editable hook variants. Optional `labelId` selects the timed label to replace; omission varies the first label. Set `render: true` to queue all exports. Frames, layers, animation, other labels and music are preserved. Automatic captions use `generate_video_captions`; apply returned timed labels through `save_video`.
5. Call `render_video` with `{ "id": "PROJECT_ID", "async": true }`. Poll `get_video_render_job` with the returned job ID. `update_video_render_job` supports `cancel` and `retry`.
6. Only a completed job's `renderedUrl` is the finished MP4. Its revision identifies the captured project; subsequent edits require a new render. Agents can download that URL or attach it to `create_post` when the user requests a draft or scheduling.

MCP changes appear when the browser loads/reloads the project. The browser and agent both save through revision checks; the editor does not subscribe to live agent edits. No browser automation is required to compose or render a video through MCP.

### Multiple devices in one video

`timeline.layers` adds up to **12 independent, simultaneous media/device layers**. Keep `clips` for the normal sequential edit, or use `clips: []` for a scene made entirely from devices on a shared background. Layers are drawn in array order, back to front, above the sequential footage and below text labels. They may use separate recordings or the same recording more than once.

Each layer has the same source, trim, fit/crop, volume and `deviceFrame` fields as a clip, plus `startMs` on the shared timeline. Its end is `startMs + outMs - inMs`. Source playback begins at `inMs`; motion, entrance/exit and keyframes begin at local time zero when the layer starts. Layers do not accept clip transitions. Use device entrance/exit animations and independently timed recordings to demonstrate a handoff between apps.

For example, pass this timeline through MCP `save_video` (with the retrieved project revision when updating), REST videos create/update, or CLI `videos update --data @project.json`. Replace the URLs and trims with your uploaded recordings:

```json
{
  "version": 1, "aspectRatio": "1:1",
  "background": {"color": "#112233", "endColor": "#445566"},
  "clips": [],
  "layers": [
    {
      "id": "watch", "name": "Watch demo", "kind": "video",
      "sourceUrl": "https://media.example.com/watch.mp4",
      "startMs": 0, "inMs": 0, "outMs": 4000,
      "fit": "contain", "x": 0.5, "y": 0.5, "zoom": 1, "volume": 0,
      "deviceFrame": {"device": "watch", "background": "#112233", "color": "#171717", "x": 0.3, "y": 0.5, "scale": 0.65, "motion": "orbit", "motionDurationMs": 4000, "animation": {"entrance": {"preset": "pop", "durationMs": 500}}}
    },
    {
      "id": "iphone", "name": "iPhone demo", "kind": "video",
      "sourceUrl": "https://media.example.com/iphone.mp4",
      "startMs": 1000, "inMs": 0, "outMs": 3000,
      "fit": "contain", "x": 0.5, "y": 0.5, "zoom": 1, "volume": 1,
      "deviceFrame": {"device": "iphone", "background": "#112233", "color": "#171717", "x": 0.7, "y": 0.5, "scale": 0.5, "motion": "float", "motionDurationMs": 3000, "animation": {"entrance": {"preset": "slide-up", "durationMs": 500}}}
    }
  ],
  "labels": [],
  "music": {"url": "", "volume": 0.8, "offsetMs": 0, "fadeInMs": 0, "fadeOutMs": 0},
  "coverMs": 1500
}
```

The Watch appears first; the iPhone joins at one second; both end at four seconds. Change either frame to `watch` to show two Watches. Each recording's volume is independent; mute duplicated audio when using the same recording in several layers. Browser copies start muted. The output length includes the latest layer end. After sequential clips finish, the shared canvas continues while remaining layers play. A scene without active sequential footage uses the shared background, or black when no background is set.

In the browser use **Device layers → Layer selected footage**, **Layer from Media** or **Upload layer**. Select a layer to edit its frame and motion, appearance time, source trims, volume and name. Drag a device on the canvas to move it; use Bring forward / Send backward for stacking and Duplicate layer for another instance. These edits share undo, autosave and revision checks. The catalog returned by `list_device_frames` describes this contract and includes a paired-device example. Prompt composition can also produce independently placed layers when requested.

This simulates product interaction with synchronized recordings and animation. It does not connect to or control the live apps.

### Prompt-based video composition

Call MCP `get_video_composer`, CLI `relay video-composer status`, or authenticated `GET /api/v1/videos/compose` to check availability and limits. Full capabilities includes `data.videoComposer`; `?section=video-composer` returns that catalog directly. Generation requires server-side `OPENAI_API_KEY`; optional `OPENAI_VIDEO_COMPOSER_MODEL` overrides the default `gpt-4.1-mini`. The model must support image inputs and structured outputs. Credentials are never returned to clients.

MCP `generate_video_composition`, CLI `relay videos compose --data @composition-request.json`, and authenticated `POST /api/v1/videos/compose` share this request:

```json
{
  "prompt": "Make a clean cinematic launch for Aura, with bold titles and gentle device movement. Use only the product facts I supplied.",
  "productName": "Aura",
  "durationMs": 15000,
  "timeline": {
    "version": 1, "aspectRatio": "9:16",
    "clips": [{
      "id": "recording", "name": "Aura walkthrough", "kind": "video",
      "sourceUrl": "https://media.example.com/recording.mp4",
      "inMs": 0, "outMs": 20000, "sourceDurationMs": 20000,
      "fit": "contain", "x": 0.5, "y": 0.5, "zoom": 1, "volume": 1
    }],
    "labels": [],
    "music": {"url": "", "volume": 0.8, "offsetMs": 0, "fadeInMs": 0, "fadeOutMs": 0},
    "coverMs": 0
  }
}
```

Replace the example URL and source timing with recordings already uploaded to the Relay media library. Prompt length is 10–4000 characters, product name is optional (up to 120 characters), and duration is 1000–60000ms (default 15000). The service sends the prompt, metadata and a bounded set of selected recording frames to OpenAI, then validates the resulting source references, trim ranges, animations and transitions against Relay's timeline contract. It preserves the selected music settings; it does not invent media URLs or generate new footage.

The response is `{data:{timeline,summary,warnings,provider:"openai"}}`. It is an **editable preview**: generation does not save, render or publish a project. Inspect warnings and timing, then pass the generated `timeline` through `save_video` with the current project `id` and `revision`. Retrieve and merge after any revision conflict. Subsequent rendering uses the existing render-job workflow. The browser follows the same sequence: Generate → review preview → Apply composition → normal autosave. Applying creates one undoable edit.

Status requires `videos:read`; generation requires `videos:write`. Provider configuration, refusal, invalid output and generation errors are returned without mutating the project. An agent can also compose a timeline directly with its own reasoning and `save_video`; the generation service is optional.

Destructive operations use explicitly named deletion tools, with additional confirmation fields for bulk and high-impact deletions. Immediate external publishing uses a dedicated tool or requires `publishNow: true`. PostgreSQL ownership checks, R2 rendering, idempotency, scheduling, and publishing remain in Relay's REST API. User administration, API-key management, OAuth changes, provider credentials, and connected-account deletion remain browser-only.

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

## Creative Studio, queues and agent access

See [Creative Studio and agent workflows](CREATIVE_STUDIO.md) for timeline JSON, asynchronous renders, captions, templates, variants, recurring queues, ideas, creative analytics, and MCP stdio/HTTP setup.

## Device frames for product demos

Discover frames before designing:

- `GET /api/v1/capabilities` includes `features: ["device-frames", ...]` and `data.deviceFrames`.
- `GET /api/v1/capabilities?section=device-frames` returns only the catalog in `data`.
- CLI: `relay device-frames list`.
- MCP: `list_device_frames` (also discoverable through `get_capabilities`).

Both REST discovery requests require a valid Relay API key or session, using the same authentication as capabilities discovery. No AI provider key is needed. Saving/rendering retains the existing video/slideshow write scopes.

The catalog lists `phone`, `tablet`, `browser`, `iphone`, `iphone-duo`, `mac`, `watch`, and `android`, defaults, valid configuration examples, and `layouts` for each supported output ratio. Layout `canvas`, `outer`, and `screen` dimensions/coordinates are pixels, derived from the actual renderer. Use them to place text around the device; label coordinates remain normalized fractions of the **whole canvas**, not the device screen. These are stylized built-in bezels, not photorealistic manufacturer meshes. Layouts describe the default pose; motion changes the projected screen location.

Set `deviceFrame` on each `timeline.clips[]` entry or `slides[]` entry. All three properties are required when enabled:

```json
{"device":"phone","background":"#E8E2D8","color":"#171717"}
```

`background` is the solid color outside the device; `color` is the frame color. Both must be six-digit hex colors. Choose `fit: "contain"` to preserve the whole interface with possible letterboxing, or `"cover"` to fill the screen with possible cropping. Video `x`, `y`, and `zoom` operate inside the screen; zoom applies only to cover. Labels stay above the frame on the full canvas.

### Framed image or carousel

Save this as `framed-image.json`, replacing the URL with an image returned by this workspace's media library:

```json
{
  "name": "Product screenshot",
  "caption": "A clearer view of the app.",
  "slides": [{
    "mediaUrl": "https://YOUR_R2_PUBLIC_HOST/screenshot.png",
    "fit": "contain",
    "deviceFrame": {"device":"phone","background":"#E8E2D8","color":"#171717"}
  }]
}
```

Create with `relay slideshows create --data @framed-image.json` or MCP `save_slideshow`, then render with `relay slideshows render --id SLIDESHOW_ID` or MCP `render_slideshow`. The result's `data.slides[].renderedUrl` contains ordered 1080×1920 JPEGs. One slide can be used for a single-image post; multiple slides form a carousel. Image layouts use the catalog's `9:16` geometry.

### Framed video (or still image in a video)

Save this as `framed-video.json`, replacing the media URL and choosing a trim within the source duration:

```json
{
  "name": "Product demo",
  "caption": "See the app in action.",
  "timeline": {
    "version": 1,
    "aspectRatio": "9:16",
    "clips": [{
      "id": "screen",
      "name": "App recording",
      "sourceUrl": "https://YOUR_R2_PUBLIC_HOST/recording.mp4",
      "kind": "video",
      "inMs": 0,
      "outMs": 5000,
      "fit": "contain",
      "x": 0.5,
      "y": 0.5,
      "zoom": 1,
      "volume": 1,
      "deviceFrame": {"device":"phone","background":"#E8E2D8","color":"#171717"}
    }],
    "labels": [],
    "music": {"url":"","volume":0.8,"offsetMs":0,"fadeInMs":0,"fadeOutMs":0},
    "coverMs": 0
  }
}
```

Create with `relay videos create --data @framed-video.json` or MCP `save_video`. For a still-image clip, use `kind: "image"` and an image URL; `outMs - inMs` sets its displayed duration. Video output supports `9:16`, `4:5`, `1:1`, and `16:9`.

Enqueue with `relay videos render --id VIDEO_ID --data '{"async":true}'` or MCP `render_video` with `async: true`. Poll `relay render-jobs get --id JOB_ID` or MCP `get_video_render_job`. Only a completed job's `renderedUrl` is ready to attach to a draft post; enqueueing is not completion or publishing.

To update, retrieve the full project first. Preserve its other fields and clips/slides, pass the retrieved video `revision`, and omit `deviceFrame` on entries where framing should be removed. After changing a slideshow slide, omit its stale `renderedUrl`. Render again before using the new design in posts. Previously rendered/published media remains unchanged.

### Device pose, backgrounds and motion

Video timeline clips accept optional `deviceFrame.x`/`y` (whole-canvas center, 0–1), `scale` (.25–1.5), `rotateX`/`rotateY` (-60–60 degrees), `rotateZ` (-180–180 degrees), and `foldAngle` (0–165 degrees, Duo only; 0 is open). These differ from the clip's crop `x`/`y`/`zoom`. The recording plays on the moving device while timed labels remain on the whole canvas. The iPhone frame has a slim metal rim, side buttons, glass bezel and Dynamic Island. Projected metal body depth follows X/Y tilt, orbit and Duo folding in preview and export. Use modest angles for a dimensional product demo; full 360-degree spins, mesh models and rear camera geometry are not implemented.

`motion` accepts `none`, `orbit`, `float`, `fold`, `unfold`, or `fold-cycle`. Folding presets require `iphone-duo`. `motionDurationMs` is 500–60000ms (default 4000); optional `motionEasing` uses the easing choices below. Motion follows local clip time, starting at the clip's assembled timeline start. Orbit/float/fold-cycle repeat; fold/unfold hold the final pose. For folding presets, a positive `foldAngle` sets the maximum fold; 0 or omission uses 150 degrees. Authored `foldAngle` keyframes override the folding preset; orbit/float still compose with the authored pose. Trimming or splitting starts animation again at local time zero; splitting does not preserve continuous motion from the original clip.

```json
{
  "device": "iphone-duo",
  "background": "#182422",
  "backgroundEnd": "#537C68",
  "color": "#171717",
  "x": 0.5,
  "y": 0.55,
  "scale": 0.85,
  "rotateX": -8,
  "rotateY": 12,
  "rotateZ": -4,
  "motion": "fold-cycle",
  "motionDurationMs": 4000
}
```

Duo divides **one recording** across the left and right hinged panels. It does not record simulator pose changes or accept a separate outer-screen recording. Preview and MP4 export evaluate the same perspective/motion model, including body depth; device presets use projected panels rather than a full 3D mesh/camera/lighting system.

Optional `timeline.background: {"color":"#182422","endColor":"#537C68"}` applies a solid or diagonal gradient to the whole video, overriding each frame's background. For unframed media choose `contain` to expose the background; `cover` fills the output. Per-frame `backgroundEnd` adds a gradient when no timeline background is set.

To put an image behind the devices, upload/select a static image in Relay Media and set the optional `imageUrl` and `imageFit` fields:

```json
{"background":{"color":"#182422","endColor":"#537C68","imageUrl":"https://YOUR_R2_LIBRARY/background.jpg","imageFit":"cover"}}
```

Saving a project or template rejects background URLs outside the configured Relay library before a database write, including neighboring path prefixes, embedded credentials, query strings and encoded path separators. The browser normalizer stays independent of storage configuration; the authenticated server enforces this library boundary.

`imageFit` is `cover` (default, centered crop) or `contain` (centered letterbox). Color/gradient remains beneath transparent areas and letterboxes. Export auto-orients the image from EXIF metadata and decodes it once per render. Use a still PNG/JPEG/WebP/AVIF image: animated images and SVG backgrounds are rejected. Only HTTPS URLs within the configured Relay R2 library are downloaded; external websites, redirects, invalid image bytes, images over 30 MB or 40 megapixels are rejected. This shared background also works with `clips: []` and independent Watch/iPhone layers, and continues after sequential footage ends while remaining layers play. Unframed cover-fit footage hides the canvas image. `list_device_frames` exposes the contract under `canvasBackground`, and both MCP transports accept it through `save_video`, composition, templates and variants. Use `prepare_media_upload` with an image content type, upload the bytes with HTTP PUT, then use its returned `url` as `imageUrl`.

Slideshow frames support static devices/colors/gradients. Device pose and animation require a video timeline; still-image clips inside video timelines support them. Unsupported slideshow animation is rejected. Custom frame assets, video backgrounds, custom Bezier curves, lighting and depth of field are not implemented. Settings survive saved templates and hook variants; saved-template footage replacement rescales frame keyframe times to clip lifetime, label keyframe times to the remapped label lifetime, and global camera keyframe times to the new scene lifetime. Legacy single-source recipes and `videos batch` do not apply frames. Use timeline projects and `videos variants` for framed variants.

### Camera zoom, focus and pans

Use `timeline.camera` to highlight a feature with a zoom-in, pan between details, hold a close-up and zoom back out. It transforms the composed clips/device layers below steady labels. It supports fullscreen recordings, Watch/iPhone scenes and images; audio and source trims are unchanged. The browser's **Camera & focus** controls edit the same document. `list_video_animations` exposes the camera contract and examples, and `save_video`/`save_video_template` accept it through both MCP transports. Prompt composition can also return a camera track.

`zoom` is 1–4 (1 shows the whole scene); `x`/`y` are 0–1 focus coordinates on the unzoomed output canvas. Focus centers the viewport where possible and clamps near edges to avoid exposing blank borders. These coordinates are independent of source crop and device position. Up to 100 sparse keyframes use unique increasing `timeMs` in 0–900000 on the **global assembled timeline clock**, continuous across cuts and overlapping transitions. Include zoom or a focus coordinate in every key. Missing properties interpolate independently from the base pose; the last value holds. Easing belongs to the departing key and defaults to linear. Unknown camera fields and invalid values are rejected. Keep keys inside the scene lifetime to see them.

Retrieve the complete project and revision before updating it. Add this camera to its timeline, keeping its clips, labels, layers and music. This four-second focus move zooms into the upper-right feature, holds, then returns to the full scene:

```json
{
  "zoom": 1, "x": 0.5, "y": 0.5,
  "keyframes": [
    {"timeMs": 0, "zoom": 1, "x": 0.5, "y": 0.5, "easing": "ease-in-out"},
    {"timeMs": 1000, "zoom": 2.5, "x": 0.7, "y": 0.35},
    {"timeMs": 3000, "zoom": 2.5, "x": 0.7, "y": 0.35, "easing": "ease-in-out"},
    {"timeMs": 4000, "zoom": 1, "x": 0.5, "y": 0.5}
  ]
}
```

Save through MCP `save_video`, preview/scrub in the editor, enqueue with `render_video` and poll `get_video_render_job`. Rendering captures the saved camera at that revision. Bulk text variants preserve the camera track, and saved templates retime it with replacement footage. Manual/MCP camera edits need no AI provider key.

### Text, frame animation and transitions

Discover through MCP `list_video_animations`, authenticated `GET /api/v1/capabilities?section=video-animation`, or `data.videoAnimations` in full capabilities. CLI `relay capabilities get` returns the same catalog. No AI provider key is required.

Set `animation` on a timed label or `deviceFrame`. Its optional `entrance` and `exit` accept `fade`, `slide-up`, `slide-down`, `slide-left`, `slide-right`, `pop`, or `zoom`; labels additionally accept `typewriter`. Each effect has `durationMs` (50–60000), capped during playback at half the layer lifetime. Easing choices are `linear`, `ease-in`, `ease-out`, and `ease-in-out`; effects default to `ease-out`.

Label animation time zero is `label.startMs`, and `endMs` is excluded. Frame animation time zero is the trimmed clip's timeline start: source `inMs` does not offset it. Effects compose with the keyframed pose. Up to 100 sparse `keyframes` use unique, increasing `timeMs` in 0–900000; include at least one animated property per key. Each property interpolates independently from its base pose at time zero and holds its last value. Easing belongs to the **departing keyframe**, controlling the interval toward the next key; its default is `linear`. Keep keys within the layer lifetime to make them visible.

| Keyframe property | Bounds / support |
| --- | --- |
| `x`, `y` | Whole-canvas center, 0–1 |
| `scale` | Labels .1–3; devices .25–1.5 |
| `rotateZ` | -180–180 degrees |
| `opacity` | 0–1 |
| `rotateX`, `rotateY` | Devices only, -60–60 degrees |
| `foldAngle` | iPhone Duo only, 0–165 degrees |

Set `transition` on the **incoming clip** with `kind` of `crossfade`, `slide-left`, `slide-right`, `wipe-left`, `wipe-right`, or `zoom`, `durationMs` (50–60000), and optional easing (default `linear`). The first clip ignores it. Effective overlap is `min(durationMs, previous clip lifetime / 2, incoming clip lifetime / 2)`. The assembled timeline duration subtracts overlaps; labels, music and cover use that resulting clock. Source audio crossfades linearly during overlaps regardless of visual easing. Sequential cuts remain available by omitting `transition`.

This valid `save_video` input illustrates a 7400ms app demo. Replace media URLs with recordings from `list_media`; update existing projects with their retrieved `id` and `revision`.

```json
{
  "name": "Animated app demo",
  "timeline": {
    "version": 1, "aspectRatio": "9:16",
    "background": {"color": "#182422", "endColor": "#537C68"},
    "clips": [
      {
        "id": "demo", "name": "App walkthrough", "kind": "video",
        "sourceUrl": "https://media.example.com/demo.mp4", "inMs": 0, "outMs": 4000,
        "fit": "contain", "x": 0.5, "y": 0.5, "zoom": 1, "volume": 1,
        "deviceFrame": {
          "device": "iphone-duo", "background": "#182422", "color": "#171717",
          "animation": {
            "entrance": {"preset": "slide-up", "durationMs": 600, "easing": "ease-out"},
            "exit": {"preset": "fade", "durationMs": 400},
            "keyframes": [{"timeMs": 0, "foldAngle": 0, "rotateY": -12, "easing": "ease-in-out"}, {"timeMs": 3000, "foldAngle": 130, "rotateY": 12}]
          }
        }
      },
      {
        "id": "cta", "name": "Try the app", "kind": "video",
        "sourceUrl": "https://media.example.com/cta.mp4", "inMs": 0, "outMs": 4000,
        "fit": "contain", "x": 0.5, "y": 0.5, "zoom": 1, "volume": 1,
        "transition": {"kind": "crossfade", "durationMs": 600, "easing": "ease-in-out"}
      }
    ],
    "labels": [{
      "id": "hook", "text": "Your app, in action", "startMs": 0, "endMs": 3000,
      "x": 0.5, "y": 0.18, "width": 0.84, "fontSize": 64, "font": "modern",
      "textColor": "#FFFFFF", "background": "dark", "backgroundColor": "#000000", "style": "dark",
      "animation": {
        "entrance": {"preset": "typewriter", "durationMs": 1000, "easing": "linear"},
        "exit": {"preset": "fade", "durationMs": 400},
        "keyframes": [{"timeMs": 0, "scale": 0.9, "easing": "ease-out"}, {"timeMs": 2000, "scale": 1}]
      }
    }],
    "music": {"url": "", "volume": 0.8, "offsetMs": 0, "fadeInMs": 0, "fadeOutMs": 0},
    "coverMs": 2000
  }
}
```
