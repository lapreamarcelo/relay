# Relay CLI

The Relay CLI is the primary automation interface for agents, scripts, and CI. It is a thin JSON client over Relay's REST API, so the dashboard, CLI, and optional MCP adapter share the same ownership checks, validation, rendering, scheduling, and publishing worker.

## Authentication

Create a secret under **Settings → API keys**. Relay displays it once. Export the Relay origin and secret in the shell that will run the CLI:

```bash
export RELAY_URL="https://relay.example.com"
export RELAY_API_KEY="relay_sk_..."
```

Do not place the key in prompts, command arguments, source files, or committed configuration. API keys may manage Relay content, brands, media, creative projects, analytics, and publishing defaults. Creating keys, OAuth connections, provider credentials, user administration, and disconnecting social accounts remain browser-only operations.

Run the repository CLI with:

```bash
pnpm relay -- accounts list
```

Every successful command prints JSON to stdout. Errors print `{ "error": "..." }` to stderr and return a nonzero exit code. Add `--compact` for one-line JSON.

## JSON input and filters

Mutating commands accept the exact object documented for the matching endpoint in [Agent API guide](AGENT_API.md):

```bash
pnpm relay -- posts create --data @post.json
pnpm relay -- posts update --data - < updated-post.json
pnpm relay -- posts delete --id post-id
```

`--data` accepts inline JSON, `@path` for a JSON file, or `-` for stdin. Repeat `--query key=value` for filters:

```bash
pnpm relay -- analytics report \
  --query from=2026-08-01T00:00:00Z \
  --query to=2026-08-31T23:59:59Z \
  --query provider=instagram
```

## Commands

| Resource | Actions |
| --- | --- |
| `capabilities` | `get` |
| `device-frames` | `list` |
| `accounts` | `list` |
| `brands` | `list`, `create`, `update`, `delete` |
| `posts` | `list`, `create`, `update`, `delete` |
| `campaigns` | `list`, `create`, `update`, `delete` |
| `templates` | `list`, `create`, `delete` |
| `media` | `list`, `upload`, `rename`, `move`, `delete`, `source-status`, `search-stock`, `import-stock` |
| `folders` | `list`, `create`, `rename`, `delete` |
| `slideshows` | `list`, `get`, `create`, `update`, `delete`, `render`, `schedule` |
| `videos` | `list`, `get`, `create`, `update`, `delete`, `render`, `schedule`, `batch` |
| `analytics` | `report` |
| `reports` | `list`, `create`, `delete` |
| `settings` | `get`, `set` |
| `providers` | `list` |
| `notifications` | `list`, `read` |
| `health` | `check` |

Run `pnpm relay -- --help` for the same command summary.

### Design with device frames

Run `relay device-frames list` before composing a product demo. The authenticated catalog returns built-in device choices including iPhone Duo, pose/motion controls, solid/gradient backgrounds, defaults, per-aspect-ratio screen geometry, JSON examples, and design constraints. `relay capabilities get` includes the same catalog under `data.deviceFrames`.

Set `deviceFrame: {"device":"phone","background":"#E8E2D8","color":"#171717"}` on a video timeline clip or slideshow slide. Use `fit: "contain"` to keep the whole UI visible. Frames work with screenshots and recordings; no AI keys or frame image downloads are needed.

```sh
relay device-frames list
relay slideshows create --data @framed-image.json
relay slideshows render --id SLIDESHOW_ID
relay videos create --data @framed-video.json
relay videos render --id VIDEO_ID --data '{"async":true}'
relay render-jobs get --id JOB_ID
```

See [complete image/video payloads and design rules](AGENT_API.md#device-frames-for-product-demos). Retrieve existing projects before updating; preserve the full document and video revision. Render results can then be attached to draft posts. These commands do not schedule or publish content.

### Animate app demos

`relay capabilities get` includes `data.videoAnimations`: text/frame entrance and exit presets, typewriter text, sparse keyframes, easing choices, clip transitions, bounds and examples. The same catalog is available through MCP `list_video_animations` or authenticated `GET /api/v1/capabilities?section=video-animation`.

Put `animation` on timed labels or `deviceFrame`, and `transition` on the incoming clip. Label keyframe time zero is its `startMs`; frame keyframe time zero is the trimmed clip's start, independent of source `inMs`. A departing keyframe controls easing to the next key. Transitions shorten the timeline by overlapping at most half of either adjacent clip; calculate label/music/cover times accordingly. Frame/label animations are supported on video timelines, including image clips, and remain editable through `videos create`/`update` and MCP `save_video`/`save_video_template`. See [bounds, timing and a complete save payload](AGENT_API.md#text-frame-animation-and-transitions).

### Prompt-based app demos

Multiple devices are expressed as `timeline.layers` in the normal videos create/update payload: independently timed Watch/iPhone recordings with per-device pose, animation and volume. Array order controls stacking. See [the multi-device example](AGENT_API.md#multiple-devices-in-one-video).

`relay video-composer status` checks provider configuration and limits. `relay videos compose --data @composition-request.json` sends `{prompt,timeline,productName?,durationMs?}` and returns an editable preview in `data.timeline`, with a summary and warnings. Generation uses the server's configured OpenAI account and bounded recording frames; it does not save the project. Review the result, then use `videos update` with the full document and current revision, followed by `videos render` when ready. See [the shared composition contract](AGENT_API.md#prompt-based-video-composition).

### Media uploads

The CLI requests a short-lived R2 upload URL from Relay and streams the file directly to storage:

```bash
pnpm relay -- media upload --file ./clip.mp4 --project media-folder-id
pnpm relay -- media upload --file ./theme.mp3 --project music-folder-id --kind music
```

Supported file extensions determine the content type automatically. Use `--content-type` when an extension is ambiguous. List folders with `folders list` and assets with `media list --query project=<id> --query kind=media`.

Rename a folder by its stable ID. Rename or move an asset by its R2 object key:

```bash
pnpm relay -- folders rename --data '{ "id": "folder-id", "name": "Launch assets" }'
pnpm relay -- media rename --data '{ "key": "media/old-name.mp4", "name": "demo.mp4" }'
pnpm relay -- media move --data '{ "key": "media/demo.mp4", "projectId": "folder-id", "kind": "media" }'
```

Use `"projectId": "unfiled"` to move an asset out of a named folder. Moving or renaming an object changes its public R2 URL; Relay updates references in posts, slideshows, and video projects before removing the old key.

Search the configured Pexels source and import a selected result directly into a folder or unfiled Media:

```bash
pnpm relay -- media source-status
pnpm relay -- media search-stock --data '{ "provider": "pexels", "query": "tennis court" }'
pnpm relay -- media import-stock --data '{ "id": "photo-id", "url": "https://images.pexels.com/...", "folderId": "folder-id" }'
```

`folders delete --id <id>` permanently removes a folder and every object it contains.

### Create and schedule a post

Use a stable `clientRequestId` for every automated creation. `status` is `draft`, `scheduled`, or `publishing`; immediate publishing is a real external action.

```bash
pnpm relay -- posts create --data @post.json
```

Create up to 100 posts by sending `{ "posts": [...] }`. Bulk rescheduling and retrying failed targets use `posts update` with the request bodies documented in the Agent API guide.

### Slideshow workflow

Create or update a project with every editor field—ordered slides, fit, label position, dimensions, font, colors, and background—then render it:

```bash
pnpm relay -- slideshows create --data @slideshow.json
pnpm relay -- slideshows render --id slideshow-id
```

`slideshows schedule` combines rendering and post creation. Its JSON contains `projectId`, `scheduledAt` (an ISO timestamp or `null` to publish immediately), optional `clientRequestId`, optional `campaignId`/`text`, and complete post `targets`:

```bash
pnpm relay -- slideshows schedule --data @schedule-slideshow.json
```

Bulk-create up to 50 projects with `slideshows create --data '{ "projects": [...] }`. Use separate schedule commands when each rendered variant needs an explicit publishing decision.

### Video workflow and bulk hooks

Video project JSON exposes the editor's source media, music, and every label value: text, normalized position and dimensions, size, font, foreground/background colors, and style.

```bash
pnpm relay -- videos create --data @video.json
pnpm relay -- videos render --id video-id
pnpm relay -- videos schedule --data @schedule-video.json
```

`videos schedule` accepts the same scheduling envelope as slideshows. `videos batch --data @batch.json` renders up to 20 hook variants and can schedule them with fixed, rotating, random, or no music. Batch scheduling uses the publishing defaults saved under Settings.

### Publishing defaults

```bash
pnpm relay -- settings get
pnpm relay -- settings set --data @publishing-defaults.json
```

The settings object controls Instagram image/video format, Facebook video format, TikTok privacy/interactions, and YouTube privacy/audience. Relay normalizes invalid or missing values.

## Raw API escape hatch

New REST endpoints are immediately usable without waiting for a named command:

```bash
pnpm relay -- request GET /api/v1/posts
pnpm relay -- request PATCH /api/v1/posts --data @changes.json
```

Paths must begin with `/`. The CLI only sends the configured key to the configured `RELAY_URL` origin; direct R2 upload is limited to the short-lived signed URL returned by Relay.

## Creative Studio, queues and agent access

See [Creative Studio and agent workflows](CREATIVE_STUDIO.md) for timeline JSON, asynchronous renders, captions, templates, variants, recurring queues, ideas, creative analytics, and MCP stdio/HTTP setup.
