# Relay: creative production and scheduling plan

Date: 7 September 2026. Implementation status updated 8 September 2026.

## Implementation status

The working tree now includes the multi-clip editor, trimming/splitting/reordering, per-clip crop, four aspect ratios, timed text, music controls, cover frames, local recovery and revision-aware autosave. Durable rendering runs separately from publishing, with progress, cancellation, retries and immutable output URLs.

Also implemented: eight starter video layouts and personal templates, duration-aware template replacement, hook variants, editable segment captions and SRT, brand text styles and writing guidance, queue slots and pause/resume, campaign shift previews and draft recipes, idea inbox, creative attribution, comparable-age analytics and posting-time observations. REST, CLI and MCP expose these workflows; MCP supports both stdio and authenticated Streamable HTTP. See [Creative Studio](CREATIVE_STUDIO.md) for configuration and examples.

Validation: 84 unit/provider/CLI/MCP tests passed; the full desktop/mobile browser suite passed 49 tests with one existing skip. Editor tests passed again after final preview fixes. Separate real-PostgreSQL, FFmpeg and HTTP MCP smoke checks passed. Production build and workspace typechecks passed. No production deployment or real social publishing was performed; external AI calls and production R2/provider integration still need configured-environment verification.

The broader proposal below remains a roadmap, not a claim that every bullet shipped. Outstanding work includes preview proxies and audio waveforms, word-level caption highlighting, dedicated slideshow/cover template galleries, logo composition, saved calendar views and richer production-state indicators, UTM/conversion integrations, and notification-assisted publishing. Team collaboration, new networks, overlapping video layers and the other explicitly later editor features remain future expansion. Current templates are editable layout starters; they do not include licensed stock footage or precomposed motion graphics.


## Product direction

Make Relay the fastest way for a creator or small brand to turn existing footage into a week of polished, scheduled content and learn which creative choices worked. This is the initial audience assumption; agency workflows can follow.

The core journey should be: idea → project → platform variants → review → calendar → results → reuse.

## Current foundation

This assessment comes from repository inspection, not a live usability or production reliability audit.

- Publishing already supports Instagram, Facebook, TikTok, and YouTube, subject to provider capabilities and approved permissions.
- The calendar already implements month/week/list views, drag rescheduling, filters, campaigns, bulk actions, conflict hints, and a basic best-time heuristic. These should be improved rather than rebuilt.
- Existing post templates store text, media type, and provider settings. These are distinct from visual video templates.
- Video Studio already supports a single source clip, draggable labels, music, reusable recipes, batch hooks, rendering, and composer handoff.
- The current FFmpeg renderer produces a fixed 1080×1920 center crop, composites static labels, and uses fixed audio levels. The render endpoint awaits the render inside its HTTP request.
- Historical analytics and reports have existing foundations. Media folders and slideshows are also established.

Relevant code: `apps/web/app/video-studio.tsx`, `apps/web/lib/video-renderer.ts`, `apps/web/app/api/v1/videos/render/route.ts`, `apps/web/app/planning-calendar.tsx`, `apps/web/app/api/v1/templates/route.ts`.

The existing roadmap places video trimming late. Move the editor earlier to reflect the current product priority, while retaining publishing reliability as a release gate.

## Release 1: a useful timeline editor

Deliver one complete workflow: import three clips, trim and arrange them, crop each for portrait, add timed text and music, save, reopen, render, and schedule.

### Editing

- Add multiple video clips and still images from uploads or the media library.
- Show thumbnail clips on a zoomable timeline with a playhead, scrubbing, snapping, and total duration.
- Reorder, split, duplicate, delete, and trim clips using handles or exact time fields. Close gaps automatically in the initial sequential video track.
- Keep a main visual track, a timed text lane, and a music lane. Preserve source audio with individual clip controls. Add arbitrary overlapping video layers in a later release.
- Crop each clip with drag-to-reposition, zoom, fit/fill, and reset. Support 9:16, 4:5, 1:1, and 16:9 project sizes.
- Show destination-specific safe-area guides; keep guide profiles updateable as platform interfaces change.
- Give text start/end times and reusable styles. Provide source/music volume, mute, music offset, and fades.
- Add undo/redo, autosave status, recovery after refresh, keyboard controls, and accessible alternatives to dragging.
- Allow choosing a cover frame; publish covers where the destination supports them.

### Layout

Left: media, text, audio, templates. Center: preview with safe-area toggle. Right: settings for the selected item. Bottom: timeline. Top: project name, aspect ratio, save status, undo/redo, and create post.

### Technical prerequisites

- Introduce a versioned project document with asset references, clip in/out points, ordering, transforms, timed elements, and audio settings. Use consistent time units across preview and export.
- Migrate existing single-source recipes into one-clip projects; preserve their current rendering behavior and existing output links.
- Share composition semantics across browser preview and server export. Test matching crop, text placement, timing, and audio against representative inputs.
- Use lightweight preview proxies and cached thumbnails/waveforms for larger assets. Avoid loading full source files into application memory when streaming or local files suffice.
- Move rendering into a durable queue with progress, cancellation, bounded retries, resource limits, and immutable revision-based outputs. Isolate render capacity from time-sensitive publishing workers.
- Associate each render with the exact project revision. Later edits must not silently replace an output already attached to a scheduled post.
- Support the project document through the existing REST/CLI surfaces after the UI workflow stabilizes.

### Release gate

The three-clip workflow survives refresh; portrait/landscape and silent/audio sources export correctly; preview and export agree; closing the browser does not lose rendering; failed rendering cannot produce a publishable placeholder; current recipes and scheduled posts continue working.

## Release 2: templates and faster production

Templates should be editable compositions with replaceable slots, not flattened sample videos.

Each template includes media slots, suggested lengths, text fields, timing, crop defaults, music behavior, output ratios, and an optional brand kit. Let users preview with their own media, replace all slots from one form, open the timeline for detailed edits, and save their own version.

Launch with these eight templates:

| Template | Structure | Inputs |
| --- | --- | --- |
| Hook + demo + CTA | Opening claim, screen recording, end card | Hook, demo, CTA |
| Three quick tips | Intro and three short segments | Three clips or images, three tips |
| Before/after | Labeled sequential comparison | Two clips, explanation |
| Product walkthrough | Three steps with numbered labels | Product footage and steps |
| Testimonial | Speaker, supplied quote, brand end card | Authorized footage and actual quote |
| B-roll story | Several shots with timed narrative | Clips and text |
| Feature announcement | Problem, new feature, demonstration | Feature name, footage, CTA |
| Weekly recap | Highlights followed by closing card | Three to five assets and titles |

Also add slideshow and cover templates, brand colors/fonts/logos, and save-as-template from any project. Start with curated templates and a personal library; defer a marketplace.

Add editable auto-subtitles, word highlighting, SRT export, and caption styles in this release. Transcription should expose progress and cost where applicable. Start with a few tested languages.

Build on existing bulk hooks: replace template fields in batches, preview every variant, render chosen variants, and send them to drafts or selected calendar slots.

Release gate: create five distinct draft videos from one template without rebuilding the timeline; longer text triggers fitting guidance; changing a template does not alter existing projects.

## Release 3: excellent daily scheduling

- Add recurring posting slots per account, fill-next-slot, content categories, and visible empty-slot suggestions.
- Allow moving a whole campaign while preserving relative spacing, with a preview of timezone and daylight-saving effects.
- Add pause/resume for future queue work and a failed-post recovery center. Clearly distinguish already-dispatched posts from cancellable work.
- Make destination-specific captions, covers, aspect ratios, validation, and publish state easy to review together.
- Improve calendar thumbnails and saved views; expose production states such as editing, rendering, ready, and scheduled.
- Improve the existing best-time heuristic using comparable posts grouped by account/platform, content type, metric, and observation window. Show sample size and uncertainty; keep manual slots available.
- Add asset usage and duplicate warnings, especially when reusing media from past campaigns.
- Investigate notification-assisted publishing for features requiring completion in a native app. Validate support per provider before promising music, stickers, or tagging.

Release gate: fill a week, shift the campaign, pause pending work, and recover one failed destination without duplicating successful posts.

## Release 4: turn performance into the next creative decision

- Link every post to its project, template version, hook, and variant.
- Compare templates and hooks using platform-appropriate metrics and equal post-age windows. Label observational comparisons; do not imply causal A/B results.
- Offer “make a new version” from a successful post with editable footage, opening text, and CTA.
- Add an idea inbox with brand, campaign, content pillar, notes, and source links.
- Offer grounded assistance: hook alternatives, caption rewrites, and weekly draft plans based on supplied brand material and prior posts.
- Add UTM presets and optional conversion-source integrations so performance can extend beyond views.

Potential signature workflow: select a folder, choose a template and five hooks, review five edits, fill five slots, then compare results and reuse the strongest format.

## Later expansion

Team roles, approval gates, version-linked comments, and audit history become the next priority if agencies are the primary audience. Start engagement tools with supported comment workflows before attempting a broad unified inbox. Prioritize additional networks using actual customer demand and verified API access.

Other later editor features: picture-in-picture, split screen, simple transitions, speech-aware music ducking, long-video clipping, and suggested subject reframing. Defer professional color grading, advanced keyframes, complex motion graphics, and real-time collaborative editing until core usage justifies their cost.

## Delivery sequence and measurement

Use milestone gates rather than promising dates before a renderer/preview spike. Relative scope: editor and render foundations are large; template slots and captions are medium-to-large; queue improvements are medium; attribution and creative reporting are medium-to-large. Existing code can be reused, but production hardening and provider constraints materially affect effort.

First implementation slice:

1. Versioned project model and compatibility fixtures.
2. Queued rendering with revision-bound artifacts.
3. Three-clip timeline, trim/reorder, per-clip crop, preview/export agreement.
4. Timed text, audio controls, autosave, undo, and composer handoff.
5. Three initial templates: hook/demo/CTA, three tips, and before/after.

Measure a baseline first. Track median time from importing clips to scheduling, editor completion rate, template reuse, weekly publishing creators, on-time dispatch and provider-confirmed publishing separately, render failures, publish failures, and recovery time. A proposed usability target is a three-clip post scheduled within five minutes excluding upload/render time; validate it with real users rather than presenting it as a current capability.

## Market references

Checked 7 September 2026. Vendor pages describe their own products; these are capability references, not independent rankings.

- [Buffer publishing](https://buffer.com/publish): platform customization, scheduling, and notification-assisted workflows.
- [VEED timeline editor](https://www.veed.io/create/video-maker/timeline-video-maker): timeline editing as a familiar creative interaction.
- [VEED custom templates](https://support.veed.io/en/articles/11550463-how-to-create-and-use-templates): reusable layouts, timing, branding, and captions.

These establish useful expectations. Relay's proposed positioning is an integrated create–schedule–learn workflow, with self-hosting and agent access as additional strengths. This is a product hypothesis to validate, not a claim of market uniqueness.
