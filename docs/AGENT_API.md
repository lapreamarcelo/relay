# Relay agent API

Relay exposes a small REST API for trusted agents and automations. The API uses the same validation, database, and publishing worker as the dashboard.

## Create a key

Sign in to Relay, open **Settings → API keys**, and create a key. Relay shows the secret once. Send it with every request:

```http
Authorization: Bearer relay_sk_...
Content-Type: application/json
```

Agent keys can read brands and connected destinations and can read, create, reschedule, publish, and delete posts. They cannot manage users, brands, provider credentials, or social connections.

Set these values in the agent environment rather than its prompt:

```env
RELAY_URL=https://relay.example.com
RELAY_API_KEY=relay_sk_...
```

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
    "text": "The post caption",
    "mediaType": "image",
    "mediaUrl": "https://media.example.com/posts/launch.jpg",
    "status": "scheduled",
    "scheduledAt": "2026-09-01T10:00:00Z",
    "targets": [{
      "accountId": "connected-account-id",
      "settings": { "kind": "instagram", "publishType": "feed" }
    }]
  }'
```

`mediaType` is `none`, `image`, or `video`. A public HTTPS `mediaUrl` is required for image and video posts. Uploading new agent-provided files is intentionally outside this first API version; use an existing object from Relay's R2 media library.

For a TikTok photo slideshow, keep `mediaType: "image"`, set `mediaUrl` to the first rendered slide (the cover), and send every ordered slide in `mediaUrls`. Relay accepts up to 35 images and preserves their order through TikTok's `photo_images` payload. Multi-image posts currently support TikTok destinations only.

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
    "settings": { "kind": "tiktok", "privacyLevel": "SELF_ONLY", "allowComments": true, "allowDuet": false, "allowStitch": false }
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
      { "id": "cover", "mediaUrl": "https://media.example.com/media/cover.jpg", "text": "A title", "fit": "cover", "textPosition": "bottom", "textSize": 64, "textColor": "#FFFFFF", "textBackground": "dark" },
      { "id": "detail", "mediaUrl": "https://media.example.com/media/detail.jpg", "fit": "cover", "textPosition": "bottom", "textSize": 64, "textColor": "#FFFFFF", "textBackground": "dark" }
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

Rendering creates one versioned 1080×1920 PNG per slide under `slideshows/<project-id>/` in R2 and returns each URL as `renderedUrl`. Project instructions live in PostgreSQL; rendered R2 images are immutable publishing artifacts. Schedule them through `/api/v1/posts` using the ordered `renderedUrl` values in `mediaUrls`.

### Platform settings

Each target needs settings matching its connected provider:

```json
{ "kind": "instagram", "publishType": "feed" }
{ "kind": "facebook", "publishType": "feed", "linkUrl": "https://example.com" }
{ "kind": "tiktok", "privacyLevel": "SELF_ONLY", "allowComments": true, "allowDuet": false, "allowStitch": false }
{ "kind": "youtube", "title": "Video title", "tags": ["relay"], "privacyStatus": "private", "madeForKids": false }
```

Instagram `publishType` supports `feed`, `reel`, or `story`. Facebook supports `feed` or `reel`. YouTube privacy supports `private`, `unlisted`, or `public`. TikTok validates the requested options against the creator's current capabilities at publish time.

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

## Delete or cancel posts

Delete one post with `id`, or up to 100 with `ids`:

```bash
curl -X DELETE "$RELAY_URL/api/v1/posts" \
  -H "Authorization: Bearer $RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["post-id-1", "post-id-2"] }'
```

Deletion is all-or-nothing. Relay refuses the request if any post does not belong to the key owner or has already entered provider publishing/processing.

## MCP adapter

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

The adapter exposes `list_destinations`, `list_media`, `list_slideshows`, `save_slideshow`, `create_slideshows`, `render_slideshow`, and `schedule_slideshow`. It remains a thin client: PostgreSQL ownership checks, R2 rendering, idempotency, scheduling, and publishing stay in Relay's REST API.
