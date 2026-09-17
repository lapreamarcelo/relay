# Creative Studio and agent workflows

Relay now stores editable, versioned video timelines. The browser, REST API, CLI and MCP use the same project document. Existing single-clip recipes remain available under **Label recipes / bulk hooks**.

## Editing and rendering

Video Studio supports a sequential track of up to 50 videos/images, split/trim/reorder/duplicate, crop positioning and zoom, four aspect ratios, timed text, music volume/offset/fades, undo/redo, autosave, local recovery and cover-frame selection. Subtitles can be imported/exported as SRT. Eight starter layouts and saved composition templates are available under Templates; brand text styles can be applied in the inspector.

Rendering runs in a separate `renderer` service, with a persisted job, progress, cancellation and retry. A job captures the exact project revision. Updating a project does not change previously rendered URLs or posts already using them. MP4s and JPEG covers are added to the Media library. The cover passes into the composer for destinations that support custom images or frame offsets.

The original synchronous render endpoint remains compatible with existing integrations. New integrations should request asynchronous rendering, poll the job, and create the post only after completion. Legacy batch rendering remains synchronous; `videos variants` provides editable variants with queued rendering.

## Deploying

Apply the SQL migrations and rebuild the web, publishing worker and renderer together. Both Compose configurations include the dedicated renderer. It needs PostgreSQL, the same R2 configuration as the web app, FFmpeg and the packaged fonts. The publishing worker remains separate from CPU-heavy rendering.

```sh
docker compose up -d --build
```

Automatic captions require `OPENAI_API_KEY` on the web and renderer. Caption generation sends the timeline's trimmed source audio to OpenAI Whisper, returns editable timed segments, and does not silently replace text in the project. Adding the returned captions creates a normal editable revision. Review machine transcription before publishing.


## CLI

Use the existing `RELAY_URL` and `RELAY_API_KEY` environment variables. All output is JSON; every mutation accepts `--data @file.json` or JSON from stdin.

```sh
relay capabilities get
relay video-templates list
relay videos create --data @project.json
relay videos get --id VIDEO_ID
relay videos update --data @edited-project.json
relay videos render --id VIDEO_ID --data '{"async":true}'
relay render-jobs get --id JOB_ID
relay render-jobs update --data '{"id":"JOB_ID","action":"cancel"}'
relay render-jobs update --data '{"id":"JOB_ID","action":"retry"}'
relay videos captions --id VIDEO_ID
relay videos variants --data @variants.json
relay video-templates create --data @template.json
relay queues list
relay queues set --data @queue.json
relay queues fill --data @fill.json
relay campaigns operate --data @campaign-operation.json
relay ideas list
relay ideas create --data @idea.json
relay brand-kits list
relay brand-kits set --data @brand-kit.json
relay analytics creative --query hours=72
relay analytics timing --query accountId=ACCOUNT_ID
```

Use `pnpm relay --` in place of `relay` for a repository-local installation.

### Project document

```json
{
  "name": "Launch demo",
  "caption": "A better way to plan your week.",
  "labels": [],
  "timeline": {
    "version": 1,
    "aspectRatio": "9:16",
    "clips": [
      {
        "id": "demo",
        "name": "Product demo",
        "sourceUrl": "https://YOUR_R2_PUBLIC_HOST/demo.mp4",
        "kind": "video",
        "inMs": 1000,
        "outMs": 6000,
        "fit": "cover",
        "x": 0.5,
        "y": 0.5,
        "zoom": 1,
        "volume": 1
      }
    ],
    "labels": [
      {
        "id": "hook",
        "text": "Plan your week in one place",
        "startMs": 0,
        "endMs": 3000,
        "x": 0.5,
        "y": 0.2,
        "width": 0.84,
        "height": 0.12,
        "fontSize": 64,
        "font": "modern",
        "textColor": "#FFFFFF",
        "background": "dark",
        "backgroundColor": "#000000",
        "style": "dark"
      }
    ],
    "music": {"url":"", "volume":0.8, "offsetMs":0, "fadeInMs":0, "fadeOutMs":0},
    "coverMs": 1000
  }
}
```

For video clips, optional `sourceDurationMs` records the probed source duration and prevents trims beyond it; the renderer also verifies the real source. Saved templates remap label and cover timing when replacement clips have different lengths.

Clip order defines playback order; `inMs`/`outMs` refer to the source. Label times refer to the assembled timeline. Crop `x`/`y` are fractions in `[0,1]`; zoom ranges from 1 to 3 and applies to fill/crop mode. Images use the same duration fields. Maximum composition duration is 15 minutes; individual providers may impose tighter limits. Media must be accessible through the configured R2 public origin to render.

For updates, retrieve the project first and pass its `id` and `revision` with the full edited project. A stale revision returns HTTP 409. Do not retry a conflict by dropping the revision. Merge against the new document instead.

Render jobs are deduplicated by project, revision and kind (`render` or `captions`). Completed renders return `renderedUrl`, `coverUrl` and `coverMs`. Caption jobs return `captions`. Cancel/retry use the job ID, not the project ID. A completed job cannot be retried; edit the project to create a new revision.

### Editable hook variants

```json
{
  "id": "VIDEO_ID",
  "clientRequestId": "launch-variants-2026-09",
  "hooks": ["Your first hook", "Your second hook"],
  "render": true
}
```

The first timed label changes for each variant; all other edits remain intact. A caption containing `{hook}` is filled automatically. Reuse the same request ID with the same input when retrying. Each result includes an editable project and, when requested, a render job. Review all entries: HTTP 207 can indicate individual enqueue failures.

### Weekly queues and campaigns

```json
{
  "accountId": "ACCOUNT_ID",
  "timezone": "Europe/Madrid",
  "paused": false,
  "slots": [
    {"day": 2, "time": "09:00", "category": "tips"},
    {"day": 5, "time": "12:00", "category": "demos"}
  ]
}
```

Days are Sunday=0 through Saturday=6. Queue filling accepts `{accountId, postIds, category?, preview?}` and defaults to preview. Set `preview:false` to schedule. It accepts drafts with exactly one matching destination, validates content again under database locks, and skips occupied slots. Nonexistent DST times are skipped; an ambiguous local time is represented once. Pausing stops future scheduled dispatches, while already-dispatched posts continue.

Campaign operations accept `{id, action:"shift"|"pause"|"resume", minutes?, preview?}`. Shifts preserve elapsed spacing; local wall times can change across DST. A shift previews by default. Setting `preview:false` applies it to currently eligible scheduled posts. Re-preview after other edits before applying.

## MCP

Any MCP-capable agent can use the local stdio adapter:

```json
{
  "mcpServers": {
    "relay": {
      "command": "pnpm",
      "args": ["--dir", "/ABSOLUTE/PATH/TO/Relay", "--filter", "@relay/mcp", "start"],
      "env": {
        "RELAY_URL": "https://YOUR_RELAY_HOST",
        "RELAY_API_KEY": "YOUR_SCOPED_RELAY_KEY"
      }
    }
  }
}
```

Store keys in the client’s secret configuration, not in source control. MCP tool schemas expose the entire timeline document and all new planning workflows.

For agents supporting Streamable HTTP, run the adapter with:

```sh
RELAY_URL=https://YOUR_RELAY_HOST MCP_TRANSPORT=http MCP_PORT=3100 pnpm --filter @relay/mcp start
```

With the repository Compose file, `docker compose --profile agents up -d --build` also starts the MCP adapter. Its port is bound to localhost by default; route `/mcp` through an HTTPS reverse proxy for remote clients.

The endpoint is `http://127.0.0.1:3100/mcp`. Configure the client to send `Authorization: Bearer YOUR_SCOPED_RELAY_KEY`. Each request uses that client's own key; the server does not use a shared workspace key. Place the service behind your HTTPS reverse proxy for remote access. Set `MCP_HOST=0.0.0.0` inside containers; the `mcp` Docker target sets this automatically. Browser-origin requests are rejected unless `MCP_ALLOWED_ORIGIN` matches exactly.

HTTP mode offers signed media upload preparation, letting the agent upload its own bytes directly. It intentionally excludes the local `upload_media` file-path tool, so remote clients cannot read the MCP host filesystem. The CLI and local stdio adapter retain local upload support.

Authentication uses scoped Relay keys. This release does not implement an OAuth authorization-server discovery flow; clients requiring OAuth-only connectors need an additional auth integration.

## Analytics and reuse

Creative attribution is captured when creating a post from a completed queued render. It preserves project revision, template and hook on the post. Creative analytics compare each account/platform separately, using observations near the end of a 24-, 72- or 168-hour post-age window. Missing metrics remain unavailable. These comparisons are observational, not randomized experiments.

Posting-time recommendations require at least 20 comparable posts and three observations in a weekday/hour/content-type group. They use views captured between 58 and 72 hours after publication. Users can always choose their own weekly slots.

## Verification

- Unit tests cover timeline boundaries, split preservation, subtitle round trips, template timing and DST behavior.
- `apps/web/scripts/render-smoke.ts` renders synthetic video with real FFmpeg and stubbed R2 I/O.
- `apps/web/scripts/creative-integration-smoke.ts` verifies database transactions and owner isolation against the dedicated localhost test database on port 55439.
- Browser tests cover timeline editing, autosave, queued rendering and composer handoff on desktop and mobile.
- MCP runtime tests exercise the SDK, schemas, per-client credentials and remote filesystem boundaries. `node apps/mcp/scripts/http-smoke.mjs` additionally verifies real HTTP handshakes, discovery, tool calls and authentication against a local mock backend.

## Campaign recipes

`campaign-recipes list|create|apply|delete` and the corresponding MCP tools manage reusable plans. Built-ins cover a launch, tutorial series and weekly content. Each entry has `title`, `text`, `dayOffset` and `format` (`video`, `image` or `text`).

Apply a recipe with `{recipeId, accountIds, clientRequestId, startAt?}`. The CLI sets `action:"apply"`; direct REST callers must include it. This creates a campaign and draft briefs with suggested dates, never scheduled posts. Add media, complete the copy and review destinations before scheduling. Offsets are elapsed 24-hour periods. Stable request IDs make retries reuse the same campaign and posts.
