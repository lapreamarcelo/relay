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
| `accounts` | `list` |
| `brands` | `list`, `create`, `update`, `delete` |
| `posts` | `list`, `create`, `update`, `delete` |
| `campaigns` | `list`, `create`, `update`, `delete` |
| `templates` | `list`, `create`, `delete` |
| `media` | `list`, `upload`, `rename`, `move`, `delete` |
| `folders` | `list`, `create`, `rename` |
| `slideshows` | `list`, `get`, `create`, `update`, `delete`, `render`, `schedule` |
| `videos` | `list`, `get`, `create`, `update`, `delete`, `render`, `schedule`, `batch` |
| `analytics` | `report` |
| `reports` | `list`, `create`, `delete` |
| `settings` | `get`, `set` |
| `health` | `check` |

Run `pnpm relay -- --help` for the same command summary.

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
