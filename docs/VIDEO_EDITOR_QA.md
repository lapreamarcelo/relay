# Video editor verification

Verified locally on 2026-10-02 against the production Next.js build.

## Results

The complete Playwright suite passed **105 tests** across desktop Chromium and the Pixel 7 mobile profile. One desktop test was intentionally skipped because it checks the mobile planner. The web unit suite passed **107 tests**, including actual FFmpeg animation/transition/multi-device renders and recording-frame sampling. TypeScript and `git diff --check` passed. Desktop and mobile multi-device and bulk-text screenshots were also inspected.

The browser run includes all **16 composer Playwright tests**, including parallel-device previews and real MP4 exports. The CLI suite also passed all **8 tests**, including composition status and preview commands.

After the final bulk-results navigation refinement, all **6 bulk-text browser tests** passed again on a fresh production build. The bulk UI uses controlled job responses and playable fixture MP4s; route tests use the production cloning/serialization path with local database and queue adapters. Real production MP4 rendering is covered by the device/composition exports described below.

The app demo checks cover:

- Eight device frames and all six supported motion presets, including Duo folding.
- All four output aspect ratios, preview sizing, and mobile overflow.
- Pose, motion, gradients and labels surviving save/reload, using production timeline validation.
- Label editing, dragging, positioning and timing.
- All eight text effects, seven frame entrance/exit effects, sparse keyframes, easing, and Duo hinge keyframes; animated label dragging moves its path.
- All six incoming clip transitions, overlapping preview layers, audio weights, duration and save/reload. FFmpeg tests also verify transitions combined with sequential cuts.
- Real recording playback, source trimming, synchronized Duo panels and a single audible source track.
- Media upload, clip/audio editing, undo, export and post-composer handoff.
- Simultaneous Watch + iPhone and two-Watch scenes: independent source trims, appearance times, rotation and audio; device selection/dragging, stacking, duplication, undo, save/reload and the 12-layer limit. Copied footage starts muted. Layers-only projects and late trims respect the 15-minute timeline limit; appended footage receives focus at its start.
- Failed-save local recovery, render cancellation and retry.
- Prompt composition from selected recordings: separate review, precise paused scrubbing, one undoable Apply, editable titles/device keyframes, autosave and reload.
- Retry, cancellation and stale-request protection; changing the brief or source selection disables applying an outdated preview. Invalid provider output, outside media URLs and out-of-range trims are rejected; disjoint trims of one recording remain valid.
- Empty media and missing provider configuration explain the next step without sending a generation request.
- A generated composition applied and edited through the browser exports through the production renderer to a playable 1080×1080 H.264/AAC MP4, with device keyframes, animated text and an overlapping crossfade. Source seeking, decoded title pixels, duration and browser playback are verified on both profiles.
- A real production-renderer export from an edited project: 1080×1080 H.264 video, AAC audio, three-second trimmed duration, animated Duo entrance/exit, background pixel checks and a label visible only from one to two seconds. Its fade entrance/exit and opacity keyframes are checked in decoded pixels. Playwright downloads the actual MP4 and verifies playback on both profiles.
- A layers-only Watch and delayed iPhone export runs through the production renderer and plays in both browser profiles. FFmpeg unit checks also cover two Watches plus an iPhone, transparent device composition, decoded source-trim pixels, independent delayed audio tones and volumes, labels/music above layers, canvas padding and matching default backgrounds.
- Prompt previews with staggered parallel devices apply as independently editable layers. Layer-only captions mix timed recording audio, and reusable templates preserve layer starts/frames while replacing footage.
- The browser's Bulk text dialog previews selected-label variants, creates ten independently editable projects, preserves the source and all device layers/music/styles/animations, and returns them to the video library. Tests cover bounds, keyboard focus, save-before-create, stable network retries, per-export retry/status, playable export previews, downloads and post-composer handoff on both profiles.

The real export test uses local storage adapters around the production renderer. FFmpeg, device composition, label composition, normalization, audio encoding, cover generation and browser decoding run normally. Authentication, persistence, render-job orchestration, R2 requests and social publishing are simulated; this run does not establish that deployed cloud configuration or connected provider accounts work. Firefox and Safari/WebKit were not exercised.

Composition service tests exercise the actual route, thumbnail extraction, source-duration probing, strict provider request and timeline compiler with a controlled provider response. They also check refusal/error handling, scoped authorization boundaries and cancellation reaching media downloads. Browser tests use the production compiler with controlled composition responses. **No live OpenAI generation was exercised:** this workspace has no configured `OPENAI_API_KEY`. Configure that key on the web service to enable real prompt generation. Manual editing and direct agent-authored timelines do not need the key.

## Reproduce

With workspace dependencies, Node.js 22.18 or later, Chromium for Playwright, FFmpeg and FFprobe installed:

```sh
cd apps/web
./node_modules/.bin/playwright test --workers=3 --reporter=list,html
node --experimental-transform-types --test lib/*.test.ts
./node_modules/.bin/tsc --noEmit
```

Playwright builds and starts the production application locally. The HTML report is written to `apps/web/playwright-report/index.html`; real MP4 attachments are retained in `apps/web/test-results`. No external posts or cloud assets are created by the tests.

## MCP integration

The MCP suite passes four tests, including real stdio and Streamable HTTP client/server connections. These exercise production timeline normalization and project serialization against a local API adapter: discovery (including `list_video_animations`), media upload preparation, project create/read/edit/save with empty legacy source URLs, eight device frames, six motion presets, text/frame effects, keyframes/easing, incoming clip transitions, full label/background/audio preservation, reusable templates, revision conflicts, render queue/cancel/retry/completion and immutable render revisions. Invalid pose values are rejected before a project API mutation. `get_video_composer` and `generate_video_composition` return a preview through both transports without saving; a subsequent explicit `save_video` applies it. Invalid prompts are rejected before reaching the composition API.

Both MCP transports preserve independently timed device layers, including layer-only two-Watch projects, and create ten selected-label variants. Invalid variant bounds are rejected before API calls, and the actual variants route rejects unknown labels before any insert. Layer transitions are rejected before a save mutation. The HTTP smoke check also passes authentication, cross-origin rejection, client-key isolation and the remote filesystem boundary. These tests replace the database, storage and job workers with a local API adapter; they do not establish a connection to a deployed workspace or install MCP in a particular agent client.

```sh
cd apps/mcp
node --test src/*.test.mjs
node scripts/http-smoke.mjs
./node_modules/.bin/tsc --noEmit
```

See [the MCP app-demo tool sequence](AGENT_API.md#editable-app-demos-through-mcp) and [connection setup](CREATIVE_STUDIO.md#mcp).
